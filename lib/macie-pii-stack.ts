import {
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";
import {
  ApiDestination,
  Authorization,
  Connection,
  EventField,
  Rule,
  RuleTargetInput,
} from "aws-cdk-lib/aws-events";
import { ApiDestination as ApiDestinationTarget } from "aws-cdk-lib/aws-events-targets";
import { Stream, StreamEncryption } from "aws-cdk-lib/aws-kinesis";
import { CfnDeliveryStream } from "aws-cdk-lib/aws-kinesisfirehose";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { FilterPattern, SubscriptionFilter } from "aws-cdk-lib/aws-logs";
import { KinesisDestination } from "aws-cdk-lib/aws-logs-destinations";
import {
  ArnPrincipal,
  Effect,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { CfnSession } from "aws-cdk-lib/aws-macie";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
} from "aws-cdk-lib/aws-s3";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Key } from "aws-cdk-lib/aws-kms";
import { nanoid } from "nanoid";

export class MaciePiiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const { STAGE, TEAMS_WEBHOOK_URL } = process.env;

    if (typeof STAGE === "undefined") {
      throw new Error("STAGE is undefined");
    }

    if (typeof TEAMS_WEBHOOK_URL === "undefined") {
      throw new Error("TEAMS_WEBHOOK_URL is undefined");
    }

    const sensitiveDataFn = new NodejsFunction(
      this,
      `Macie-Teams-Function-${STAGE}`,
      {
        entry: "./src/sensitiveData.ts",
        functionName: `SensitiveData-${STAGE}`,
        runtime: Runtime.NODEJS_14_X,
      }
    );

    const encryptionKey = new Key(this, `Macie-Teams-Key-${STAGE}`, {
      description: "Encryption key for Kinesis delivery stream S3 destination",
    });

    // Allow Macie to use customer managed KMS key https://docs.aws.amazon.com/macie/latest/user/discovery-supported-encryption-types.html
    encryptionKey.addToResourcePolicy(
      new PolicyStatement({
        actions: ["kms:Decrypt"],
        principals: [
          new ArnPrincipal(
            `arn:aws:iam::${this.account}:role/aws-service-role/macie.amazonaws.com/AWSServiceRoleForAmazonMacie`
          ),
        ],
        resources: ["*"],
      })
    );

    const s3ObjectPrefix = "fn-logs-";

    const cloudwatchLogsBucket = new Bucket(
      this,
      `Macie-Logs-Bucket-${STAGE}`,
      {
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        bucketName: `macie-logs-bucket-${STAGE}`,
        encryption: BucketEncryption.KMS,
        encryptionKey: encryptionKey,
        lifecycleRules: [
          {
            expiration: Duration.days(7),
          },
        ],
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    new Bucket(this, `Macie-Archive-Bucket-${STAGE}`, {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      bucketName: `macie-archive-bucket-${STAGE}`,
      encryption: BucketEncryption.KMS,
      encryptionKey: encryptionKey,
      intelligentTieringConfigurations: [
        {
          archiveAccessTierTime: Duration.days(30),
          deepArchiveAccessTierTime: Duration.days(90),
          name: `Macie-Archive-Bucket-Tiering-${STAGE}`,
          prefix: s3ObjectPrefix,
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const stream = new Stream(this, `Macie-Teams-Stream-${STAGE}`, {
      encryption: StreamEncryption.KMS,
      encryptionKey: encryptionKey,
      streamName: `Macie-Teams-Stream-${STAGE}`,
    });

    const deliveryStreamRole = new Role(
      this,
      `Macie-Teams-DeliveryStream-Role-${STAGE}`,
      {
        assumedBy: new ServicePrincipal("firehose.amazonaws.com"),
        description:
          "Permit Kinesis Firehose delivery stream access to source Kinesis stream and destination S3 bucket",
        inlinePolicies: {
          allowKinesisStreamSource: new PolicyDocument({
            statements: [
              new PolicyStatement({
                actions: [
                  "kinesis:DescribeStream",
                  "kinesis:GetShardIterator",
                  "kinesis:GetRecords",
                  "kinesis:ListShards",
                ],
                effect: Effect.ALLOW,
                resources: [
                  stream.streamArn, // arn:aws:kinesis:region:account-id:stream/stream-name
                ],
              }),
              new PolicyStatement({
                actions: ["kms:Decrypt"],
                conditions: {
                  StringEquals: {
                    "kms:ViaService": `kinesis.${this.region}.amazonaws.com`,
                  },
                  StringLike: {
                    "kms:EncryptionContext:aws:kinesis:arn": stream.streamArn, // arn:aws:kinesis:region:account-id:stream/stream-name,
                  },
                },
                effect: Effect.ALLOW,
                resources: [
                  encryptionKey.keyArn, // arn:aws:kms:region:account-id:key/key-id
                ],
              }),
            ],
          }),
          allowS3BucketDestination: new PolicyDocument({
            statements: [
              new PolicyStatement({
                actions: [
                  "s3:AbortMultipartUpload",
                  "s3:GetBucketLocation",
                  "s3:GetObject",
                  "s3:ListBucket",
                  "s3:ListBucketMultipartUploads",
                  "s3:PutObject",
                ],
                effect: Effect.ALLOW,
                resources: [
                  cloudwatchLogsBucket.bucketArn, // arn:aws:s3:::bucket-name
                  cloudwatchLogsBucket.arnForObjects("*"), // arn:aws:s3:::bucket-name/*
                ],
              }),
              new PolicyStatement({
                actions: ["kms:Decrypt", "kms:GenerateDataKey"],
                conditions: {
                  StringEquals: {
                    "kms:ViaService": `s3.${this.region}.amazonaws.com`,
                  },
                  StringLike: {
                    "kms:EncryptionContext:aws:s3:arn": [
                      cloudwatchLogsBucket.bucketArn, // arn:aws:s3:::bucket-name
                      cloudwatchLogsBucket.arnForObjects("*"), // arn:aws:s3:::bucket-name/*
                    ],
                  },
                },
                effect: Effect.ALLOW,
                resources: [
                  encryptionKey.keyArn, // arn:aws:kms:region:account-id:key/key-id
                ],
              }),
            ],
          }),
        },
        roleName: `Macie-Teams-DeliveryStream-Role-${STAGE}`,
      }
    );

    const deliveryStream = new CfnDeliveryStream(
      this,
      `Macie-Teams-DeliveryStream-${STAGE}`,
      {
        deliveryStreamName: `Macie-Teams-DeliveryStream-${STAGE}`,
        deliveryStreamType: "KinesisStreamAsSource",
        kinesisStreamSourceConfiguration: {
          kinesisStreamArn: stream.streamArn,
          roleArn: deliveryStreamRole.roleArn,
        },
        s3DestinationConfiguration: {
          bucketArn: cloudwatchLogsBucket.bucketArn,
          encryptionConfiguration: {
            kmsEncryptionConfig: {
              awskmsKeyArn: encryptionKey.keyArn,
            },
          },
          // https://docs.aws.amazon.com/macie/latest/user/discovery-supported-formats.html
          compressionFormat: "GZIP",
          prefix: s3ObjectPrefix,
          roleArn: deliveryStreamRole.roleArn,
        },
      }
    );

    new SubscriptionFilter(this, `Macie-Teams-SubscriptionFilter-${STAGE}`, {
      destination: new KinesisDestination(stream),
      filterPattern: FilterPattern.allEvents(),
      logGroup: sensitiveDataFn.logGroup,
    });

    new CfnSession(this, `Macie-Teams-Session-${STAGE}`, {
      findingPublishingFrequency: "SIX_HOURS",
      status: "ENABLED",
    });

    // Unique token to ensure the idempotency of Macie /jobs request
    const clientToken = nanoid(10);

    // See https://docs.aws.amazon.com/macie/latest/APIReference/jobs.html
    new AwsCustomResource(this, `Macie-Teams-Job-${STAGE}`, {
      onCreate: {
        service: "Macie2",
        action: "createClassificationJob",
        parameters: {
          clientToken: clientToken,
          description: "Detect sensitive data in Lambda function logs",
          initialRun: false,
          jobType: "SCHEDULED",
          managedDataIdentifierSelector: "ALL",
          name: `Function-Logs-PII-${STAGE}`,
          s3JobDefinition: {
            bucketDefinitions: [
              {
                accountId: this.account,
                buckets: [cloudwatchLogsBucket.bucketName],
              },
            ],
          },
          scheduleFrequency: {
            dailySchedule: {},
          },
        },
        physicalResourceId: PhysicalResourceId.fromResponse("jobId"),
      },
      policy: {
        statements: [
          new PolicyStatement({
            actions: ["macie2:CreateClassificationJob"],
            effect: Effect.ALLOW,
            resources: ["arn:aws:macie2:*:*:classification-job/*"],
          }),
        ],
      },
    });

    const secret = new Secret(this, `Macie-Teams-Secret-${STAGE}`, {
      description:
        "A fake password for MS Teams webhook requests. Teams does not require auth for webhook POST requests",
      secretName: "FakeTeamsSecret",
    });

    const connection = new Connection(this, `Macie-Teams-Connection-${STAGE}`, {
      authorization: Authorization.basic(
        "fake-teams-user",
        SecretValue.secretsManager(secret.secretName)
      ),
      connectionName: `Macie-Teams-Connection-${STAGE}`,
      description:
        "Connection with fake basic username/password auth. Teams does not require auth for webhook POST requests",
    });

    const destination = new ApiDestination(
      this,
      `Macie-Teams-Destination-${STAGE}`,
      {
        apiDestinationName: `Macie-Teams-Destination-${STAGE}`,
        connection: connection,
        description:
          "Calling MS Teams webhook with Basic username/password auth",
        endpoint: TEAMS_WEBHOOK_URL,
      }
    );

    // Rule on default event bus. Macie sends events to default bus
    new Rule(this, `Macie-Teams-Rule-${STAGE}`, {
      eventPattern: {
        detailType: ["Macie Finding"],
        source: ["aws.macie"],
      },
      ruleName: `Macie-Teams-Rule-${STAGE}`,
      targets: [
        new ApiDestinationTarget(destination, {
          // deadLetterQueue: ,
          // See: https://docs.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/connectors-using
          // See: https://docs.aws.amazon.com/macie/latest/user/findings-publish-event-schemas.html)
          event: RuleTargetInput.fromObject({
            "@type": "MessageCard",
            "@context": "http://schema.org/extensions",
            summary: "Macie Finding",
            text: `Macie has detected potentially sensitive data in CloudWatch Logs`,
            title: `Macie Finding for job ${EventField.fromPath(
              "$.detail.classificationDetails.jobId"
            )}`,
            themeColor: "ee0000",
            sections: [
              {
                facts: [
                  {
                    name: "Job ID",
                    value: EventField.fromPath(
                      "$.detail.classificationDetails.jobId"
                    ),
                  },
                  {
                    name: "Severity",
                    value: EventField.fromPath("$.detail.severity.description"), // Example: Low
                  },
                  {
                    name: "Type",
                    value: EventField.fromPath("$.detail.type"), // Example: SensitiveData:S3Object/Multiple
                  },
                ],
                markdown: true,
                startGroup: true,
              },
            ],
            potentialAction: [
              {
                "@type": "OpenUri",
                name: "View job",
                targets: [
                  {
                    os: "default",
                    uri: `https://${
                      this.region
                    }.console.aws.amazon.com/macie/home?region=${
                      this.region
                    }#findings?tab=job&search=classificationDetails.jobId%3D${EventField.fromPath(
                      "$.detail.classificationDetails.jobId"
                    )}&macros=current`,
                  },
                ],
              },
              {
                "@type": "OpenUri",
                name: "Create issue",
                targets: [
                  {
                    os: "default",
                    uri: "https://legogroup.atlassian.net/jira/software/c/projects/SET/boards/1214",
                  },
                ],
              },
            ],
          }),
        }),
      ],
    });
  }
}

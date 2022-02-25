import { RemovalPolicy, SecretValue, Stack, StackProps } from "aws-cdk-lib";
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
  EventBus,
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

    const bucket = new Bucket(this, `Macie-Teams-Bucket-${STAGE}`, {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      bucketName: `macie-teams-bucket-${STAGE}`,
      encryption: BucketEncryption.KMS,
      encryptionKey: encryptionKey,
      // intelligentTieringConfigurations: [],
      removalPolicy: RemovalPolicy.DESTROY,
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
                  bucket.bucketArn, // arn:aws:s3:::bucket-name
                  bucket.arnForObjects("*"), // arn:aws:s3:::bucket-name/*
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
                      bucket.bucketArn, // arn:aws:s3:::bucket-name
                      bucket.arnForObjects("*"), // arn:aws:s3:::bucket-name/*
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
          bucketArn: bucket.bucketArn,
          encryptionConfiguration: {
            kmsEncryptionConfig: {
              awskmsKeyArn: encryptionKey.keyArn,
            },
          },
          // compressionFormat: "GZIP",
          // prefix: "logs",
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

    new AwsCustomResource(this, `Macie-Teams-Job-${STAGE}`, {
      onCreate: {
        service: "Macie2",
        action: "createClassificationJob",
        parameters: {
          description: "Detect sensitive data in Lambda function logs",
          initialRun: true,
          jobType: "SCHEDULED",
          managedDataIdentifierSelector: "ALL",
          name: `Logs-PII-${STAGE}`,
          s3JobDefinition: {
            bucketDefinitions: [
              {
                accountId: this.account,
                buckets: [bucket.bucketName],
              },
            ],
          },
          scheduleFrequency: {
            dailySchedule: {},
          },
        },
        physicalResourceId: PhysicalResourceId.fromResponse("jobId"),
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
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
      description:
        "Connection with fake basic username/password auth. Teams does not require auth for webhook POST requests",
    });

    const destination = new ApiDestination(
      this,
      `Macie-Teams-Destination-${STAGE}`,
      {
        connection,
        endpoint: TEAMS_WEBHOOK_URL,
        description:
          "Calling MS Teams webhook with Basic username/password auth",
      }
    );

    const eventBus = new EventBus(this, `Macie-Teams-EventBus-${STAGE}`, {
      eventBusName: "macie-teams-alerts",
    });

    new Rule(this, "Macie-Teams-Rule", {
      eventBus: eventBus,
      eventPattern: {
        detailType: ["Macie Finding"],
        source: ["aws.macie"],
      },
      targets: [
        new ApiDestinationTarget(destination, {
          // See: https://docs.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/connectors-using
          // See: https://docs.aws.amazon.com/macie/latest/user/findings-publish-event-schemas.html)
          event: RuleTargetInput.fromObject({
            "@type": "MessageCard",
            "@context": "http://schema.org/extensions",
            summary: "Macie Finding",
            text: `Macie Finding for job ${EventField.fromPath(
              "$.detail.classificationDetails.jobId"
            )}`,
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
                    uri: `https://eu-central-1.console.aws.amazon.com/macie/home?region=eu-central-1#jobs?itemId=${EventField.fromPath(
                      "$.detail.classificationDetails.jobId"
                    )}`,
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
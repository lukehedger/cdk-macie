# cdk-macie

Deploy an Amazon Macie sensitive data detection pipeline with AWS CDK.

- Detect sensitive data in Lambda function logs
- Monitor pipeline health via CloudWatch alarms
- Secured with data encryption at rest and in transit
- Costs optimised to the max

## Architecture

![PII Detection](https://user-images.githubusercontent.com/1913316/165085863-b9a3ab9d-6599-444a-b8dd-f1e4eea16fd6.jpeg)

## Deploy

```
STAGE=xxx TEAMS_WEBHOOK_URL=xxx npx cdk deploy
```

## Invoke function

```
aws lambda invoke --function-name SensitiveData-{STAGE} response.json
```

## Resources

- [Talk: Sensitive Data Detection Pipelines](https://slides.com/lh4/sensitive-data-detection-pipelines-06fc75)

## TODO

- [ ] Use distinct KMS customer managed keys across services (S3, Kinesis)
- [ ] Configure S3 bucket for long-term results storage, with Intelligent Tiering https://docs.aws.amazon.com/macie/latest/APIReference/classification-export-configuration.html
- [ ] Add CloudWatch log alarm for errors https://aws.amazon.com/about-aws/whats-new/2021/04/amazon-macie-adds-cloudwatch-logging-for-job-status-and-health-monitoring-of-sensitive-data-discovery-jobs/, https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/FilterAndPatternSyntax.html
- [ ] Publish Macie Sensitive Data Findings to Security Hub https://docs.aws.amazon.com/macie/latest/APIReference/findings-publication-configuration.html
- [ ] Add auto-remediation (via Teams message button click and Step Functions workflow) to delete log stream from CloudWatch and clean up S3 object

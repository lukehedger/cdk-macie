# cdk-macie

Deploy Amazon Macie infrastructure with AWS CDK

## Architecture

![PII Detection](https://user-images.githubusercontent.com/1913316/159051507-507b5bb7-b264-4cfd-88c1-064609a64c49.jpeg)

## Deploy

```
STAGE=xxx TEAMS_WEBHOOK_URL=xxx npx cdk deploy
```

## Invoke function

```
aws lambda invoke --function-name SensitiveData-{STAGE} response.json
```

## TODO

- [ ] Use distinct KMS customer managed keys across services (S3, Kinesis)
- [ ] Configure S3 bucket for long-term results storage, with Intelligent Tiering https://docs.aws.amazon.com/macie/latest/APIReference/classification-export-configuration.html
- [ ] Publish Macie Sensitive Data Findings to Security Hub https://docs.aws.amazon.com/macie/latest/APIReference/findings-publication-configuration.html
- [ ] Add CloudWatch log alarm for errors https://aws.amazon.com/about-aws/whats-new/2021/04/amazon-macie-adds-cloudwatch-logging-for-job-status-and-health-monitoring-of-sensitive-data-discovery-jobs/, https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/FilterAndPatternSyntax.html
- [ ] Add CloudTrail API logging

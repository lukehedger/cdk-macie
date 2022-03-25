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
- [ ] Publish Macie Sensitive Data Findings to Security Hub https://docs.aws.amazon.com/macie/latest/APIReference/findings-publication-configuration.html
- [ ] Configure S3 bucket for long-term results storage https://docs.aws.amazon.com/macie/latest/APIReference/classification-export-configuration.html

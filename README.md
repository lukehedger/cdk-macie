# cdk-macie

Deploy Amazon Macie infrastructure with AWS CDK

## Deploy

```
STAGE=xxx TEAMS_WEBHOOK_URL=xxx npx cdk deploy
```

## Invoke function

```
aws lambda invoke --function-name SensitiveData-{STAGE} response.json
```

## TODO

- [] Publish Macie Sensitive Data Findings to Security Hub https://docs.aws.amazon.com/macie/latest/APIReference/findings-publication-configuration.html
- [] Configure S3 bucket for long-term results storage https://docs.aws.amazon.com/macie/latest/APIReference/classification-export-configuration.html

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

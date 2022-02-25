#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { MaciePiiStack } from "../lib/macie-pii-stack";

const { STAGE } = process.env;

if (typeof STAGE === "undefined") {
  throw new Error("STAGE is undefined");
}

const app = new cdk.App();

new MaciePiiStack(app, `MaciePiiStack-${STAGE}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

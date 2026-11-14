#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { CareAuditStack } from "../lib/care-audit-stack";

const app = new cdk.App();
const codestarFromCtx = app.node.tryGetContext("codestarConnectionArn") as
  | string
  | undefined;
const codestarFromEnv = process.env.CODESTAR_CONNECTION_ARN?.trim();
const codestarConnectionArn = codestarFromEnv || codestarFromCtx;

new CareAuditStack(app, "PocAriaCareAuditStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "ap-northeast-1",
  },
  codestarConnectionArn,
});

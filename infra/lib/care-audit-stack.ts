import * as cdk from "aws-cdk-lib";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as path from "node:path";
import { Construct } from "constructs";

const PARTNER_ENV_KEYS = [
  "TAVILY_API_KEY",
  "DAYTONA_API_KEY",
  "DAYTONA_API_URL",
  "CODEAF_API_KEY",
  "CODEAF_API_URL",
  "NOSANA_API_KEY",
  "NOSANA_VISION_URL",
] as const;

/** S3 object key for cf-ship.sh uploads (must match scripts/cf-ship.sh). */
export const PIPELINE_SOURCE_OBJECT_KEY = "source/care-audit.zip";

export interface CareAuditStackProps extends cdk.StackProps {
  /** Optional CodeStar connection ARN for future GitHub Source (S3 remains default). */
  codestarConnectionArn?: string;
}

/** CloudFront + S3 FE + Nest via Lambda Web Adapter + S3-source CodePipeline. Amplify禁止. */
export class CareAuditStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: CareAuditStackProps) {
    super(scope, id, props);

    const siteBucket = new s3.Bucket(this, "WebAssets", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const lwaLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      "LwaLayer",
      `arn:aws:lambda:${this.region}:753240598075:layer:LambdaAdapterLayerX86:25`,
    );

    const partnerEnv: Record<string, string> = {};
    for (const key of PARTNER_ENV_KEYS) {
      const value = process.env[key]?.trim();
      if (value) partnerEnv[key] = value;
    }

    const apiFn = new lambda.Function(this, "NestLwa", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "run.sh",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../.lwa-package")),
      layers: [lwaLayer],
      memorySize: 1024,
      timeout: cdk.Duration.seconds(60),
      architecture: lambda.Architecture.X86_64,
      environment: {
        AWS_LAMBDA_EXEC_WRAPPER: "/opt/bootstrap",
        PORT: "8080",
        AWS_LWA_PORT: "8080",
        AWS_LWA_READINESS_CHECK_PATH: "/health",
        PARTNER_MODE: process.env.PARTNER_MODE ?? "auto",
        ...partnerEnv,
      },
    });

    const fnUrl = apiFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ["*"],
      },
    });

    const apiOrigin = new origins.FunctionUrlOrigin(fnUrl, {
      readTimeout: cdk.Duration.seconds(60),
    });

    const dist = new cloudfront.Distribution(this, "CareAuditCdn", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      additionalBehaviors: {
        "/api/*": {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        "/health": {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
      },
    });

    const pipelineSourceBucket = new s3.Bucket(this, "PipelineSource", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
    });

    const pipelineArtifactBucket = new s3.Bucket(this, "PipelineArtifacts", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const shipBuild = new codebuild.PipelineProject(this, "ShipBuild", {
      projectName: "poc-aria-care-audit-ship",
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      environmentVariables: {
        WEB_BUCKET: { value: siteBucket.bucketName },
        LAMBDA_FUNCTION_NAME: { value: apiFn.functionName },
        DISTRIBUTION_ID: { value: dist.distributionId },
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          install: {
            "runtime-versions": { nodejs: "20" },
            commands: ["npm install -g pnpm@9"],
          },
          pre_build: {
            commands: ["pnpm install --ignore-scripts"],
          },
          build: {
            commands: [
              "pnpm --filter @care-audit/web build",
              "bash scripts/package-lwa.sh",
              "(cd .lwa-package && zip -qr ../lwa-deploy.zip .)",
              "aws s3 sync apps/web/build s3://$WEB_BUCKET --delete",
              "aws lambda update-function-code --function-name $LAMBDA_FUNCTION_NAME --zip-file fileb://lwa-deploy.zip",
              "aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths '/*'",
            ],
          },
        },
      }),
    });

    siteBucket.grantReadWrite(shipBuild);
    apiFn.grantInvoke(shipBuild);
    shipBuild.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["lambda:UpdateFunctionCode"],
        resources: [apiFn.functionArn],
      }),
    );
    shipBuild.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudfront:CreateInvalidation"],
        resources: [
          `arn:aws:cloudfront::${this.account}:distribution/${dist.distributionId}`,
        ],
      }),
    );

    const pipeline = new codepipeline.Pipeline(this, "ShipPipeline", {
      pipelineName: "poc-aria-care-audit-ship",
      artifactBucket: pipelineArtifactBucket,
      crossAccountKeys: false,
    });

    const sourceOutput = new codepipeline.Artifact("SourceZip");

    pipeline.addStage({
      stageName: "Source",
      actions: [
        new codepipeline_actions.S3SourceAction({
          actionName: "S3_Source",
          bucket: pipelineSourceBucket,
          bucketKey: PIPELINE_SOURCE_OBJECT_KEY,
          output: sourceOutput,
          trigger: codepipeline_actions.S3Trigger.NONE,
        }),
      ],
    });

    pipeline.addStage({
      stageName: "Build",
      actions: [
        new codepipeline_actions.CodeBuildAction({
          actionName: "Ship",
          project: shipBuild,
          input: sourceOutput,
        }),
      ],
    });

    const codestarArn = props?.codestarConnectionArn?.trim();
    if (codestarArn) {
      new cdk.CfnOutput(this, "CodestarConnectionArn", {
        value: codestarArn,
        description:
          "Reserved for optional GitHub Source; default ship path uses S3 + cf-ship.sh (no Pending OAuth).",
      });
    }

    new cdk.CfnOutput(this, "DistributionDomain", {
      value: dist.distributionDomainName,
    });
    new cdk.CfnOutput(this, "ApiFunctionUrl", { value: fnUrl.url });
    new cdk.CfnOutput(this, "WebBucketName", { value: siteBucket.bucketName });
    new cdk.CfnOutput(this, "PipelineSourceBucket", {
      value: pipelineSourceBucket.bucketName,
    });
    new cdk.CfnOutput(this, "PipelineSourceObjectKey", {
      value: PIPELINE_SOURCE_OBJECT_KEY,
    });
    new cdk.CfnOutput(this, "ShipPipelineName", {
      value: pipeline.pipelineName,
    });
  }
}

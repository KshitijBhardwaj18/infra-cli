import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { prefix, region, rootDomain, apiDomain, webDomain, ecrImage } from "../config";
import { privateSubnet1, privateSubnet2, ecsSg } from "./networking";
import { db, redis, bucket, dbPassword } from "./store";
import { apiTg, webTg } from "./loadbalancer";

// Reference implementation of the compute layer the CLI generates.
//
// What is auto-injected by the generator:
//   - NODE_ENV          → "production"          (backend/worker services)
//   - DATABASE_URL      → composed from db.endpoint + dbPassword (never a standalone DATABASE_PASSWORD)
//   - REDIS_URL         → from redis cluster endpoint
//   - AWS_S3_BUCKET     → bucket.bucket
//   - AWS_S3_REGION     → region
//   - PORT              → service port (frontend services only)
//
// Everything else (app secrets, app env vars) comes from heizen.env.yaml:
//   - Secrets:  config.requireSecret("...") in store.ts, then injected by name
//   - Env vars: literal values from heizen.env.yaml `env:` sections
//
// The template does NOT inject framework-specific vars (NEXT_PUBLIC_*, BETTER_AUTH_*,
// SMTP_*, CORS_URLS, etc). If your app needs them, declare them in init.

const ecsAssumeRole = JSON.stringify({
  Version: "2012-10-17",
  Statement: [{
    Effect: "Allow",
    Principal: { Service: "ecs-tasks.amazonaws.com" },
    Action: "sts:AssumeRole",
  }],
});

const executionRole = new aws.iam.Role(`${prefix}-ecs-execution-role`, {
  name: `${prefix}-ecs-execution-role`,
  assumeRolePolicy: ecsAssumeRole,
});

new aws.iam.RolePolicyAttachment(`${prefix}-ecs-execution-policy`, {
  role: executionRole.name,
  policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
});

const s3Policy = pulumi.interpolate`{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
    "Resource": ["${bucket.arn}", "${bucket.arn}/*"]
  }]
}`;

const ssmPolicy = JSON.stringify({
  Version: "2012-10-17",
  Statement: [{
    Effect: "Allow",
    Action: [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ],
    Resource: "*",
  }],
});

const apiTaskRole = new aws.iam.Role(`${prefix}-api-task-role`, {
  name: `${prefix}-api-task-role`,
  assumeRolePolicy: ecsAssumeRole,
});

new aws.iam.RolePolicy(`${prefix}-api-s3-policy`, {
  role: apiTaskRole.name,
  policy: s3Policy,
});

new aws.iam.RolePolicy(`${prefix}-api-ssm-policy`, {
  role: apiTaskRole.name,
  policy: ssmPolicy,
});

const webTaskRole = new aws.iam.Role(`${prefix}-web-task-role`, {
  name: `${prefix}-web-task-role`,
  assumeRolePolicy: ecsAssumeRole,
});

new aws.iam.RolePolicy(`${prefix}-web-ssm-policy`, {
  role: webTaskRole.name,
  policy: ssmPolicy,
});

new aws.cloudwatch.LogGroup(`${prefix}-api-logs`, {
  name: `/ecs/${prefix}/api`,
  retentionInDays: 90,
});

new aws.cloudwatch.LogGroup(`${prefix}-web-logs`, {
  name: `/ecs/${prefix}/web`,
  retentionInDays: 90,
});

export const cluster = new aws.ecs.Cluster(`${prefix}-cluster`, {
  name: `${prefix}-cluster`,
  settings: [{ name: "containerInsights", value: "enabled" }],
  tags: { Name: `${prefix}-cluster` },
});

const redisEndpoint = redis.cacheNodes.apply((nodes: any) => nodes[0].address);
const redisPort = redis.cacheNodes.apply((nodes: any) => nodes[0].port.toString());

// Backend (api) — auto-injected vars only. App-specific vars would come from
// the user's `env:` config and be appended as additional out.push({ ... }).
const apiEnvironment = pulumi.all([
  db.endpoint, dbPassword, redisEndpoint, redisPort, bucket.bucket,
]).apply(([dbEndpoint, dbPass, rHost, rPort, bucketName]) => {
  const out: Array<{ name: string; value: string }> = [];
  out.push({ name: "NODE_ENV", value: "production" });
  out.push({ name: "DATABASE_URL", value: `postgresql://postgres:${dbPass}@${dbEndpoint}/example` });
  out.push({ name: "REDIS_URL", value: `redis://${rHost}:${rPort}` });
  out.push({ name: "AWS_S3_BUCKET", value: `${bucketName}` });
  out.push({ name: "AWS_S3_REGION", value: region });
  return out;
});

// Frontend (web) — only PORT is auto-injected. Note: no NEXT_PUBLIC_* or other
// framework assumptions. Any public env the framework needs at build/runtime
// must be declared by the user in heizen.env.yaml.
const webEnvironment = pulumi.output([
  { name: "PORT", value: "3000" },
]);

const apiTaskDef = new aws.ecs.TaskDefinition(`${prefix}-api-task`, {
  family: `${prefix}-api`,
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  cpu: "512",
  memory: "1024",
  executionRoleArn: executionRole.arn,
  taskRoleArn: apiTaskRole.arn,
  containerDefinitions: apiEnvironment.apply((env) =>
    JSON.stringify([{
      name: "api",
      image: ecrImage,
      essential: true,
      command: ["sh", "-c", "node dist/main.js"],
      portMappings: [{ containerPort: 3001, protocol: "tcp" }],
      environment: env,
      logConfiguration: {
        logDriver: "awslogs",
        options: {
          "awslogs-group": `/ecs/${prefix}/api`,
          "awslogs-region": region,
          "awslogs-stream-prefix": "api",
        },
      },
    }]),
  ),
});

const webTaskDef = new aws.ecs.TaskDefinition(`${prefix}-web-task`, {
  family: `${prefix}-web`,
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  cpu: "256",
  memory: "1024",
  executionRoleArn: executionRole.arn,
  taskRoleArn: webTaskRole.arn,
  containerDefinitions: webEnvironment.apply((env) =>
    JSON.stringify([{
      name: "web",
      image: ecrImage,
      essential: true,
      command: ["sh", "-c", "npm run start"],
      portMappings: [{ containerPort: 3000, protocol: "tcp" }],
      environment: env,
      logConfiguration: {
        logDriver: "awslogs",
        options: {
          "awslogs-group": `/ecs/${prefix}/web`,
          "awslogs-region": region,
          "awslogs-stream-prefix": "web",
        },
      },
    }]),
  ),
});

export const apiService = new aws.ecs.Service(`${prefix}-api-service`, {
  name: `${prefix}-api`,
  cluster: cluster.arn,
  taskDefinition: apiTaskDef.arn,
  desiredCount: 2,
  launchType: "FARGATE",
  enableExecuteCommand: true,
  healthCheckGracePeriodSeconds: 120,
  networkConfiguration: {
    subnets: [privateSubnet1.id, privateSubnet2.id],
    securityGroups: [ecsSg.id],
    assignPublicIp: false,
  },
  loadBalancers: [
    { targetGroupArn: apiTg.arn, containerName: "api", containerPort: 3001 },
  ],
  deploymentCircuitBreaker: { enable: true, rollback: true },
  tags: { Name: `${prefix}-api` },
}, { dependsOn: [db, redis] });

export const webService = new aws.ecs.Service(`${prefix}-web-service`, {
  name: `${prefix}-web`,
  cluster: cluster.arn,
  taskDefinition: webTaskDef.arn,
  desiredCount: 1,
  launchType: "FARGATE",
  enableExecuteCommand: true,
  healthCheckGracePeriodSeconds: 120,
  networkConfiguration: {
    subnets: [privateSubnet1.id, privateSubnet2.id],
    securityGroups: [ecsSg.id],
    assignPublicIp: false,
  },
  loadBalancers: [
    { targetGroupArn: webTg.arn, containerName: "web", containerPort: 3000 },
  ],
  deploymentCircuitBreaker: { enable: true, rollback: true },
  tags: { Name: `${prefix}-web` },
});

const apiScalingTarget = new aws.appautoscaling.Target(`${prefix}-api-scaling`, {
  maxCapacity: 10,
  minCapacity: 2,
  resourceId: pulumi.interpolate`service/${cluster.name}/${apiService.name}`,
  scalableDimension: "ecs:service:DesiredCount",
  serviceNamespace: "ecs",
});

new aws.appautoscaling.Policy(`${prefix}-api-cpu-scaling`, {
  name: `${prefix}-api-cpu-scaling`,
  policyType: "TargetTrackingScaling",
  resourceId: apiScalingTarget.resourceId,
  scalableDimension: apiScalingTarget.scalableDimension,
  serviceNamespace: apiScalingTarget.serviceNamespace,
  targetTrackingScalingPolicyConfiguration: {
    predefinedMetricSpecification: {
      predefinedMetricType: "ECSServiceAverageCPUUtilization",
    },
    targetValue: 70,
  },
});

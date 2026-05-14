import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { prefix, region, rootDomain, adminDomain, apiDomain, ecrImage } from "../config";
import { privateSubnet1, privateSubnet2, ecsSg } from "./networking";
import { db, redis, bucket, dbPassword, authSecret, smtpUser, smtpPassword } from "./store";
import { apiTg, adminTg, orgTg } from "./loadbalancer";

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

new aws.iam.RolePolicy(`${prefix}-ecr-cross-account`, {
  role: executionRole.name,
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Action: [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
      ],
      Resource: "*",
    }],
  }),
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

const workerTaskRole = new aws.iam.Role(`${prefix}-worker-task-role`, {
  name: `${prefix}-worker-task-role`,
  assumeRolePolicy: ecsAssumeRole,
});

new aws.iam.RolePolicy(`${prefix}-worker-s3-policy`, {
  role: workerTaskRole.name,
  policy: s3Policy,
});

new aws.iam.RolePolicy(`${prefix}-worker-ssm-policy`, {
  role: workerTaskRole.name,
  policy: ssmPolicy,
});

const frontendsTaskRole = new aws.iam.Role(`${prefix}-frontends-task-role`, {
  name: `${prefix}-frontends-task-role`,
  assumeRolePolicy: ecsAssumeRole,
});

new aws.iam.RolePolicy(`${prefix}-frontends-ssm-policy`, {
  role: frontendsTaskRole.name,
  policy: ssmPolicy,
});

new aws.cloudwatch.LogGroup(`${prefix}-api-logs`, {
  name: `/ecs/${prefix}/api`,
  retentionInDays: 90,
});

new aws.cloudwatch.LogGroup(`${prefix}-frontends-logs`, {
  name: `/ecs/${prefix}/frontends`,
  retentionInDays: 90,
});

new aws.cloudwatch.LogGroup(`${prefix}-worker-logs`, {
  name: `/ecs/${prefix}/worker`,
  retentionInDays: 90,
});

export const cluster = new aws.ecs.Cluster(`${prefix}-cluster`, {
  name: `${prefix}-cluster`,
  settings: [{ name: "containerInsights", value: "enabled" }],
  tags: { Name: `${prefix}-cluster` },
});

const redisEndpoint = redis.cacheNodes.apply((nodes: any) => nodes[0].address);
const redisPort = redis.cacheNodes.apply((nodes: any) => nodes[0].port.toString());

const apiEnvironment = pulumi.all([
  db.endpoint, dbPassword, redisEndpoint, redisPort, bucket.bucket, authSecret, smtpUser, smtpPassword,
]).apply(([dbEndpoint, dbPass, rHost, rPort, bucketName, authSec, smtpU, smtpP]) => [
  { name: "NODE_ENV", value: "production" },
  { name: "DATABASE_URL", value: `postgresql://postgres:${dbPass}@${dbEndpoint}/workforce` },
  { name: "REDIS_URL", value: `redis://${rHost}:${rPort}` },
  { name: "BETTER_AUTH_SECRET", value: `${authSec}` },
  { name: "BETTER_AUTH_URL", value: `https://${apiDomain}` },
  { name: "BETTER_AUTH_DOMAIN", value: `.${rootDomain}` },
  { name: "ADMIN_FRONTEND_URL", value: `https://${adminDomain}` },
  { name: "ORG_PORTAL_BASE_URL", value: `https://${rootDomain}` },
  { name: "API_URL", value: `https://${apiDomain}` },
  { name: "CORS_URLS", value: `https://${adminDomain},https://*.${rootDomain}` },
  { name: "AWS_S3_REGION", value: region },
  { name: "AWS_S3_BUCKET", value: `${bucketName}` },
  { name: "SMTP_HOST", value: "email-smtp.us-east-1.amazonaws.com" },
  { name: "SMTP_PORT", value: "465" },
  { name: "SMTP_USER", value: `${smtpU}` },
  { name: "SMTP_PASSWORD", value: `${smtpP}` },
  { name: "SMTP_FROM", value: `noreply@${rootDomain}` },
  { name: "SMTP_FROM_NAME", value: "StaffLogic" },
]);

const workerEnvironment = pulumi.all([
  db.endpoint, dbPassword, redisEndpoint, redisPort, bucket.bucket, authSecret, smtpUser, smtpPassword,
]).apply(([dbEndpoint, dbPass, rHost, rPort, bucketName, authSec, smtpU, smtpP]) => [
  { name: "NODE_ENV", value: "production" },
  { name: "DATABASE_URL", value: `postgresql://postgres:${dbPass}@${dbEndpoint}/workforce` },
  { name: "REDIS_URL", value: `redis://${rHost}:${rPort}` },
  { name: "BETTER_AUTH_SECRET", value: `${authSec}` },
  { name: "AWS_S3_REGION", value: region },
  { name: "AWS_S3_BUCKET", value: `${bucketName}` },
  { name: "SMTP_HOST", value: "email-smtp.us-east-1.amazonaws.com" },
  { name: "SMTP_PORT", value: "465" },
  { name: "SMTP_USER", value: `${smtpU}` },
  { name: "SMTP_PASSWORD", value: `${smtpP}` },
  { name: "SMTP_FROM", value: `noreply@${rootDomain}` },
  { name: "SMTP_FROM_NAME", value: "StaffLogic" },
  { name: "ADMIN_FRONTEND_URL", value: `https://${adminDomain}` },
  { name: "ORG_PORTAL_BASE_URL", value: `https://${rootDomain}` },
]);

const apiTaskDef = new aws.ecs.TaskDefinition(`${prefix}-api-task`, {
  family: `${prefix}-api`,
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  cpu: "512",
  memory: "1024",
  executionRoleArn: executionRole.arn,
  taskRoleArn: apiTaskRole.arn,
  containerDefinitions: apiEnvironment.apply(env =>
    JSON.stringify([{
      name: "api",
      image: ecrImage,
      essential: true,
      command: ["sh", "-c", "npm run db:deploy && node apps/server/dist/src/main.js"],
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

const frontendsTaskDef = new aws.ecs.TaskDefinition(`${prefix}-frontends-task`, {
  family: `${prefix}-frontends`,
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  cpu: "256",
  memory: "1024",
  executionRoleArn: executionRole.arn,
  taskRoleArn: frontendsTaskRole.arn,
  containerDefinitions: pulumi.output(JSON.stringify([{
    name: "frontends",
    image: ecrImage,
    essential: true,
    command: ["sh", "-c", "npx turbo run start --filter=admin-web --filter=org-web"],
    portMappings: [
      { containerPort: 3000, protocol: "tcp" },
      { containerPort: 3002, protocol: "tcp" },
    ],
    environment: [
      { name: "NEXT_PUBLIC_APP_URL", value: `https://${adminDomain}` },
      { name: "NEXT_PUBLIC_API_URL", value: `https://${apiDomain}` },
      { name: "NEXT_PUBLIC_BETTER_AUTH_URL", value: `https://${apiDomain}` },
      { name: "PORT", value: "3000" },
      { name: "NEXT_PUBLIC_ORG_PORTAL_PROTOCOL", value: "https" },
      { name: "NEXT_PUBLIC_APP_DOMAIN", value: rootDomain },
      { name: "NEXT_PUBLIC_LANDING_URL", value: `https://${rootDomain}` },
      { name: "NEXT_PUBLIC_ORG_PORTAL_DOMAIN", value: rootDomain },
    ],
    logConfiguration: {
      logDriver: "awslogs",
      options: {
        "awslogs-group": `/ecs/${prefix}/frontends`,
        "awslogs-region": region,
        "awslogs-stream-prefix": "frontends",
      },
    },
  }])),
});

const workerTaskDef = new aws.ecs.TaskDefinition(`${prefix}-worker-task`, {
  family: `${prefix}-worker`,
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  cpu: "256",
  memory: "512",
  executionRoleArn: executionRole.arn,
  taskRoleArn: workerTaskRole.arn,
  containerDefinitions: workerEnvironment.apply(env =>
    JSON.stringify([{
      name: "worker",
      image: ecrImage,
      essential: true,
      command: ["sh", "-c", "bun run apps/worker/src/main.ts"],
      environment: env,
      logConfiguration: {
        logDriver: "awslogs",
        options: {
          "awslogs-group": `/ecs/${prefix}/worker`,
          "awslogs-region": region,
          "awslogs-stream-prefix": "worker",
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
  loadBalancers: [{
    targetGroupArn: apiTg.arn,
    containerName: "api",
    containerPort: 3001,
  }],
  deploymentCircuitBreaker: { enable: true, rollback: true },
  tags: { Name: `${prefix}-api` },
}, { dependsOn: [db, redis] });

export const frontendsService = new aws.ecs.Service(`${prefix}-frontends-service`, {
  name: `${prefix}-frontends`,
  cluster: cluster.arn,
  taskDefinition: frontendsTaskDef.arn,
  desiredCount: 1,
  launchType: "FARGATE",
  enableExecuteCommand: true,
  healthCheckGracePeriodSeconds: 60,
  networkConfiguration: {
    subnets: [privateSubnet1.id, privateSubnet2.id],
    securityGroups: [ecsSg.id],
    assignPublicIp: false,
  },
  loadBalancers: [
    { targetGroupArn: adminTg.arn, containerName: "frontends", containerPort: 3000 },
    { targetGroupArn: orgTg.arn, containerName: "frontends", containerPort: 3002 },
  ],
  deploymentCircuitBreaker: { enable: true, rollback: true },
  tags: { Name: `${prefix}-frontends` },
});

export const workerService = new aws.ecs.Service(`${prefix}-worker-service`, {
  name: `${prefix}-worker`,
  cluster: cluster.arn,
  taskDefinition: workerTaskDef.arn,
  desiredCount: 1,
  launchType: "FARGATE",
  enableExecuteCommand: true,
  networkConfiguration: {
    subnets: [privateSubnet1.id, privateSubnet2.id],
    securityGroups: [ecsSg.id],
    assignPublicIp: false,
  },
  deploymentCircuitBreaker: { enable: true, rollback: true },
  tags: { Name: `${prefix}-worker` },
}, { dependsOn: [db, redis] });

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

const frontendsScalingTarget = new aws.appautoscaling.Target(`${prefix}-frontends-scaling`, {
  maxCapacity: 3,
  minCapacity: 1,
  resourceId: pulumi.interpolate`service/${cluster.name}/${frontendsService.name}`,
  scalableDimension: "ecs:service:DesiredCount",
  serviceNamespace: "ecs",
});

new aws.appautoscaling.Policy(`${prefix}-frontends-cpu-scaling`, {
  name: `${prefix}-frontends-cpu-scaling`,
  policyType: "TargetTrackingScaling",
  resourceId: frontendsScalingTarget.resourceId,
  scalableDimension: frontendsScalingTarget.scalableDimension,
  serviceNamespace: frontendsScalingTarget.serviceNamespace,
  targetTrackingScalingPolicyConfiguration: {
    predefinedMetricSpecification: {
      predefinedMetricType: "ECSServiceAverageCPUUtilization",
    },
    targetValue: 70,
  },
});

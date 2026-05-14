import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { prefix, region, rootDomain, ecrImage, frontendDomain, backendDomain } from "../config";
import { privateSubnet1, privateSubnet2, ecsSg } from "./networking";
import {
  dbPasswordValue,
  authSecretValue,
  db,
  bucket,
} from "./store";
import {
  frontendTg,
  backendTg,

} from "./loadbalancer";

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


new aws.cloudwatch.LogGroup(`${prefix}-frontend-logs`, {
  name: `/ecs/${prefix}/frontend`,
  retentionInDays: 90,
});
const backendTaskRole = new aws.iam.Role(`${prefix}-backend-task-role`, {
  name: `${prefix}-backend-task-role`,
  assumeRolePolicy: ecsAssumeRole,
});

new aws.iam.RolePolicy(`${prefix}-backend-s3-policy`, {
  role: backendTaskRole.name,
  policy: s3Policy,
});

new aws.iam.RolePolicy(`${prefix}-backend-ssm-policy`, {
  role: backendTaskRole.name,
  policy: ssmPolicy,
});

new aws.cloudwatch.LogGroup(`${prefix}-backend-logs`, {
  name: `/ecs/${prefix}/backend`,
  retentionInDays: 90,
});

export const cluster = new aws.ecs.Cluster(`${prefix}-cluster`, {
  name: `${prefix}-cluster`,
  settings: [{ name: "containerInsights", value: "enabled" }],
  tags: { Name: `${prefix}-cluster` },
});


const sharedEnv = pulumi.all([
  db.endpoint, dbPasswordValue.secretString,
  authSecretValue.secretString,
  bucket.bucket,
]).apply((vals) => {
  let i = 0;
  const dbEndpoint = vals[i++] as string;
  const dbPass = vals[i++] as string;
  const authSec = vals[i++] as string;
  const bucketName = vals[i++] as string;
  return [
    { name: "NODE_ENV", value: "production" },
    { name: "DATABASE_URL", value: `postgresql://postgres:${dbPass}@${dbEndpoint}/heizen` },
    { name: "BETTER_AUTH_SECRET", value: authSec },
    { name: "AWS_S3_REGION", value: region },
    { name: "AWS_S3_BUCKET", value: bucketName },
  ];
});

const frontendTaskDef = new aws.ecs.TaskDefinition(`${prefix}-frontend-task`, {
  family: `${prefix}-frontend`,
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  cpu: "256",
  memory: "512",
  executionRoleArn: executionRole.arn,
  taskRoleArn: executionRole.arn,
  containerDefinitions: pulumi.output(JSON.stringify([{
    name: "frontend",
    image: ecrImage,
    essential: true,
    command: ["sh", "-c", "npm run dev"],
    portMappings: [
      { containerPort: 3000, protocol: "tcp" },
    ],
    environment: [
      { name: "PORT", value: "3000" },
      { name: "NEXT_PUBLIC_APP_DOMAIN", value: rootDomain },
    ],
    logConfiguration: {
      logDriver: "awslogs",
      options: {
        "awslogs-group": `/ecs/${prefix}/frontend`,
        "awslogs-region": region,
        "awslogs-stream-prefix": "frontend",
      },
    },
  }])),
});

export const frontendService = new aws.ecs.Service(`${prefix}-frontend-service`, {
  name: `${prefix}-frontend`,
  cluster: cluster.arn,
  taskDefinition: frontendTaskDef.arn,
  desiredCount: 1,
  launchType: "FARGATE",
  enableExecuteCommand: true,
  networkConfiguration: {
    subnets: [privateSubnet1.id, privateSubnet2.id],
    securityGroups: [ecsSg.id],
    assignPublicIp: false,
  },
  loadBalancers: [
    { targetGroupArn: frontendTg.arn, containerName: "frontend", containerPort: 3000 },
  ],
  deploymentCircuitBreaker: { enable: true, rollback: true },
  tags: { Name: `${prefix}-frontend` },
});

const frontendScalingTarget = new aws.appautoscaling.Target(`${prefix}-frontend-scaling`, {
  maxCapacity: 3,
  minCapacity: 1,
  resourceId: pulumi.interpolate`service/${cluster.name}/${frontendService.name}`,
  scalableDimension: "ecs:service:DesiredCount",
  serviceNamespace: "ecs",
});

new aws.appautoscaling.Policy(`${prefix}-frontend-cpu-scaling`, {
  name: `${prefix}-frontend-cpu-scaling`,
  policyType: "TargetTrackingScaling",
  resourceId: frontendScalingTarget.resourceId,
  scalableDimension: frontendScalingTarget.scalableDimension,
  serviceNamespace: frontendScalingTarget.serviceNamespace,
  targetTrackingScalingPolicyConfiguration: {
    predefinedMetricSpecification: {
      predefinedMetricType: "ECSServiceAverageCPUUtilization",
    },
    targetValue: 70,
  },
});
const backendTaskDef = new aws.ecs.TaskDefinition(`${prefix}-backend-task`, {
  family: `${prefix}-backend`,
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  cpu: "256",
  memory: "512",
  executionRoleArn: executionRole.arn,
  taskRoleArn: backendTaskRole.arn,
  containerDefinitions: sharedEnv.apply(env => JSON.stringify([{
    name: "backend",
    image: ecrImage,
    essential: true,
    command: ["sh", "-c", "npm run dev"],
    portMappings: [{ containerPort: 3001, protocol: "tcp" }],
    environment: [
      ...env,
    ],
    logConfiguration: {
      logDriver: "awslogs",
      options: {
        "awslogs-group": `/ecs/${prefix}/backend`,
        "awslogs-region": region,
        "awslogs-stream-prefix": "backend",
      },
    },
  }])),
});

export const backendService = new aws.ecs.Service(`${prefix}-backend-service`, {
  name: `${prefix}-backend`,
  cluster: cluster.arn,
  taskDefinition: backendTaskDef.arn,
  desiredCount: 2,
  launchType: "FARGATE",
  enableExecuteCommand: true,
  networkConfiguration: {
    subnets: [privateSubnet1.id, privateSubnet2.id],
    securityGroups: [ecsSg.id],
    assignPublicIp: false,
  },
  loadBalancers: [
    { targetGroupArn: backendTg.arn, containerName: "backend", containerPort: 3001 },
  ],
  deploymentCircuitBreaker: { enable: true, rollback: true },
  tags: { Name: `${prefix}-backend` },
});

const backendScalingTarget = new aws.appautoscaling.Target(`${prefix}-backend-scaling`, {
  maxCapacity: 5,
  minCapacity: 2,
  resourceId: pulumi.interpolate`service/${cluster.name}/${backendService.name}`,
  scalableDimension: "ecs:service:DesiredCount",
  serviceNamespace: "ecs",
});

new aws.appautoscaling.Policy(`${prefix}-backend-cpu-scaling`, {
  name: `${prefix}-backend-cpu-scaling`,
  policyType: "TargetTrackingScaling",
  resourceId: backendScalingTarget.resourceId,
  scalableDimension: backendScalingTarget.scalableDimension,
  serviceNamespace: backendScalingTarget.serviceNamespace,
  targetTrackingScalingPolicyConfiguration: {
    predefinedMetricSpecification: {
      predefinedMetricType: "ECSServiceAverageCPUUtilization",
    },
    targetValue: 70,
  },
});

import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { prefix } from "../config";
import { privateSubnet1, privateSubnet2 } from "./networking";
import { rdsSg, redisSg } from "./networking";

const config = new pulumi.Config();

export const dbPassword = config.requireSecret("dbPassword");
export const authSecret = config.requireSecret("authSecret");
export const smtpUser = config.requireSecret("smtpUser");
export const smtpPassword = config.requireSecret("smtpPassword");

const dbSubnetGroup = new aws.rds.SubnetGroup(`${prefix}-db-subnet`, {
  subnetIds: [privateSubnet1.id, privateSubnet2.id],
  tags: { Name: `${prefix}-db-subnet` },
});

export const db = new aws.rds.Instance(`${prefix}-db`, {
  identifier: `${prefix}-db`,
  engine: "postgres",
  engineVersion: "16.6",
  instanceClass: "db.t4g.small",
  allocatedStorage: 20,
  storageType: "gp3",
  dbName: "workforce",
  username: "postgres",
  password: dbPassword,
  dbSubnetGroupName: dbSubnetGroup.name,
  vpcSecurityGroupIds: [rdsSg.id],
  publiclyAccessible: false,
  storageEncrypted: true,
  backupRetentionPeriod: 7,
  deletionProtection: true,
  skipFinalSnapshot: false,
  finalSnapshotIdentifier: `${prefix}-db-final-snapshot`,
  tags: { Name: `${prefix}-db` },
}, { ignoreChanges: ["password"] });

const redisSubnetGroup = new aws.elasticache.SubnetGroup(`${prefix}-redis-subnet`, {
  subnetIds: [privateSubnet1.id, privateSubnet2.id],
  tags: { Name: `${prefix}-redis-subnet` },
});

export const redis = new aws.elasticache.Cluster(`${prefix}-redis`, {
  clusterId: `${prefix}-redis`,
  engine: "redis",
  engineVersion: "7.1",
  nodeType: "cache.t4g.small",
  numCacheNodes: 1,
  subnetGroupName: redisSubnetGroup.name,
  securityGroupIds: [redisSg.id],
  tags: { Name: `${prefix}-redis` },
});

export const bucket = new aws.s3.Bucket(`${prefix}-files`, {
  bucket: `${prefix}-files-961381384955`,
  tags: { Name: `${prefix}-files` },
});

new aws.s3.BucketVersioning(`${prefix}-files-versioning`, {
  bucket: bucket.id,
  versioningConfiguration: { status: "Enabled" },
});

new aws.s3.BucketServerSideEncryptionConfiguration(`${prefix}-files-encryption`, {
  bucket: bucket.id,
  rules: [{
    applyServerSideEncryptionByDefault: { sseAlgorithm: "AES256" },
  }],
});

new aws.s3.BucketPublicAccessBlock(`${prefix}-files-block`, {
  bucket: bucket.id,
  blockPublicAcls: true,
  ignorePublicAcls: true,
  blockPublicPolicy: false,
  restrictPublicBuckets: false,
});

new aws.s3.BucketPolicy(`${prefix}-files-policy`, {
  bucket: bucket.id,
  policy: pulumi.interpolate`{
    "Version": "2012-10-17",
    "Statement": [{
      "Sid": "PublicReadLogosAndImages",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": [
        "${bucket.arn}/public/organizations/logos/*",
        "${bucket.arn}/public/organizations/locations/*",
        "${bucket.arn}/public/vendors/logos/*"
      ]
    }]
  }`,
});

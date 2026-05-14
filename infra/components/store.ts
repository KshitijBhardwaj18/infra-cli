import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as crypto from "crypto";
import { prefix } from "../config";
import { privateSubnet1, privateSubnet2, rdsSg } from "./networking";


const dbPasswordSecret = new aws.secretsmanager.Secret(`${prefix}-db-password`, {
  name: `${prefix}/db-password`,
});

export const dbPasswordValue = new aws.secretsmanager.SecretVersion(`${prefix}-db-password-value`, {
  secretId: dbPasswordSecret.id,
  secretString: pulumi.secret(crypto.randomBytes(24).toString("hex")),
});

const authSecretSecret = new aws.secretsmanager.Secret(`${prefix}-auth-secret`, {
  name: `${prefix}/better-auth-secret`,
});

export const authSecretValue = new aws.secretsmanager.SecretVersion(`${prefix}-auth-secret-value`, {
  secretId: authSecretSecret.id,
  secretString: pulumi.secret(crypto.randomBytes(32).toString("hex")),
});


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
  dbName: "heizen",
  username: "postgres",
  password: dbPasswordValue.secretString.apply(s => s || ""),
  dbSubnetGroupName: dbSubnetGroup.name,
  vpcSecurityGroupIds: [rdsSg.id],
  publiclyAccessible: false,
  storageEncrypted: true,
  backupRetentionPeriod: 7,
  deletionProtection: true,
  skipFinalSnapshot: false,
  finalSnapshotIdentifier: `${prefix}-db-final-snapshot`,
  tags: { Name: `${prefix}-db` },
});


export const bucket = new aws.s3.Bucket(`${prefix}-files`, {
  bucket: `${prefix}-files-${crypto.randomBytes(6).toString("hex")}`,
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
  blockPublicPolicy: true,
  restrictPublicBuckets: true,
});

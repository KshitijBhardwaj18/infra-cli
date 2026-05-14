import { alb, cert } from "./components/loadbalancer";
import {
  db,
  bucket,
} from "./components/store";
import { cluster, frontendService, backendService } from "./components/compute";
import { vpc } from "./components/networking";

export const albDns = alb.dnsName;
export const certValidation = cert.domainValidationOptions;
export const clusterName = cluster.name;
export const frontendServiceName = frontendService.name;
export const backendServiceName = backendService.name;
export const dbEndpoint = db.endpoint;
export const bucketName = bucket.bucket;
export const vpcId = vpc.id;

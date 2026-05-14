import { alb, cert } from "./components/loadbalancer";
import { db, redis, bucket } from "./components/store";
import { cluster, apiService, webService } from "./components/compute";
import { vpc } from "./components/networking";

export const albDns = alb.dnsName;
export const clusterName = cluster.name;
export const apiServiceName = apiService.name;
export const webServiceName = webService.name;
export const dbEndpoint = db.endpoint;
export const redisEndpoint = redis.cacheNodes.apply((nodes) => nodes[0].address);
export const bucketName = bucket.bucket;
export const certValidation = cert.domainValidationOptions;
export const vpcId = vpc.id;

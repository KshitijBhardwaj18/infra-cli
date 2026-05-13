import * as aws from "@pulumi/aws";
import { prefix, rootDomain, adminDomain, apiDomain } from "../config";
import { vpc, publicSubnet1, publicSubnet2, albSg } from "./networking";

// ---- ACM Certificate ----

export const cert = new aws.acm.Certificate(`${prefix}-cert`, {
  domainName: `*.${rootDomain}`,
  subjectAlternativeNames: [rootDomain],
  validationMethod: "DNS",
  tags: { Name: `${prefix}-cert` },
});

// ---- ALB ----

export const alb = new aws.lb.LoadBalancer(`${prefix}-alb`, {
  name: `${prefix}-alb`,
  internal: false,
  loadBalancerType: "application",
  securityGroups: [albSg.id],
  subnets: [publicSubnet1.id, publicSubnet2.id],
  tags: { Name: `${prefix}-alb` },
});

// ---- Target Groups ----

export const apiTg = new aws.lb.TargetGroup(`${prefix}-api-tg`, {
  name: `${prefix}-api-tg`,
  port: 3001,
  protocol: "HTTP",
  vpcId: vpc.id,
  targetType: "ip",
  healthCheck: {
    path: "/api",
    matcher: "200-499",
    interval: 30,
    timeout: 5,
    healthyThreshold: 3,
    unhealthyThreshold: 2,
  },
  tags: { Name: `${prefix}-api-tg` },
});

export const adminTg = new aws.lb.TargetGroup(`${prefix}-admin-tg`, {
  name: `${prefix}-admin-tg`,
  port: 3000,
  protocol: "HTTP",
  vpcId: vpc.id,
  targetType: "ip",
  healthCheck: {
    path: "/",
    matcher: "200-499",
    interval: 30,
    timeout: 5,
    healthyThreshold: 3,
    unhealthyThreshold: 2,
  },
  tags: { Name: `${prefix}-admin-tg` },
});

export const orgTg = new aws.lb.TargetGroup(`${prefix}-org-tg`, {
  name: `${prefix}-org-tg`,
  port: 3002,
  protocol: "HTTP",
  vpcId: vpc.id,
  targetType: "ip",
  healthCheck: {
    path: "/",
    matcher: "200-499",
    interval: 30,
    timeout: 5,
    healthyThreshold: 3,
    unhealthyThreshold: 2,
  },
  tags: { Name: `${prefix}-org-tg` },
});

// ---- Listeners ----

new aws.lb.Listener(`${prefix}-http-listener`, {
  loadBalancerArn: alb.arn,
  port: 80,
  protocol: "HTTP",
  defaultActions: [{
    type: "redirect",
    redirect: {
      port: "443",
      protocol: "HTTPS",
      statusCode: "HTTP_301",
    },
  }],
});

const httpsListener = new aws.lb.Listener(`${prefix}-https-listener`, {
  loadBalancerArn: alb.arn,
  port: 443,
  protocol: "HTTPS",
  certificateArn: cert.arn,
  defaultActions: [{
    type: "forward",
    targetGroupArn: adminTg.arn,
  }],
});

// ---- Routing Rules ----

new aws.lb.ListenerRule(`${prefix}-api-rule`, {
  listenerArn: httpsListener.arn,
  priority: 100,
  conditions: [{ hostHeader: { values: [apiDomain] } }],
  actions: [{ type: "forward", targetGroupArn: apiTg.arn }],
});

new aws.lb.ListenerRule(`${prefix}-admin-rule`, {
  listenerArn: httpsListener.arn,
  priority: 200,
  conditions: [{ hostHeader: { values: [adminDomain] } }],
  actions: [{ type: "forward", targetGroupArn: adminTg.arn }],
});

new aws.lb.ListenerRule(`${prefix}-org-rule`, {
  listenerArn: httpsListener.arn,
  priority: 300,
  conditions: [{ hostHeader: { values: [`*.${rootDomain}`] } }],
  actions: [{ type: "forward", targetGroupArn: orgTg.arn }],
});
import * as aws from "@pulumi/aws";
import { prefix, rootDomain, apiDomain, webDomain } from "../config";
import { vpc, publicSubnet1, publicSubnet2, albSg } from "./networking";

export const cert = new aws.acm.Certificate(`${prefix}-cert`, {
  domainName: `*.${rootDomain}`,
  subjectAlternativeNames: [rootDomain],
  validationMethod: "DNS",
  tags: { Name: `${prefix}-cert` },
});

export const alb = new aws.lb.LoadBalancer(`${prefix}-alb`, {
  name: `${prefix}-alb`,
  internal: false,
  loadBalancerType: "application",
  securityGroups: [albSg.id],
  subnets: [publicSubnet1.id, publicSubnet2.id],
  tags: { Name: `${prefix}-alb` },
});

export const apiTg = new aws.lb.TargetGroup(`${prefix}-api-tg`, {
  name: `${prefix}-api-tg`,
  port: 3001,
  protocol: "HTTP",
  vpcId: vpc.id,
  targetType: "ip",
  healthCheck: {
    path: "/health",
    matcher: "200-399",
    interval: 30,
    timeout: 5,
    healthyThreshold: 3,
    unhealthyThreshold: 2,
  },
  tags: { Name: `${prefix}-api-tg` },
});

export const webTg = new aws.lb.TargetGroup(`${prefix}-web-tg`, {
  name: `${prefix}-web-tg`,
  port: 3000,
  protocol: "HTTP",
  vpcId: vpc.id,
  targetType: "ip",
  healthCheck: {
    path: "/",
    matcher: "200-399",
    interval: 30,
    timeout: 5,
    healthyThreshold: 3,
    unhealthyThreshold: 2,
  },
  tags: { Name: `${prefix}-web-tg` },
});

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
    targetGroupArn: webTg.arn,
  }],
});

new aws.lb.ListenerRule(`${prefix}-api-rule`, {
  listenerArn: httpsListener.arn,
  priority: 100,
  conditions: [{ hostHeader: { values: [apiDomain] } }],
  actions: [{ type: "forward", targetGroupArn: apiTg.arn }],
});

new aws.lb.ListenerRule(`${prefix}-web-rule`, {
  listenerArn: httpsListener.arn,
  priority: 200,
  conditions: [{ hostHeader: { values: [webDomain] } }],
  actions: [{ type: "forward", targetGroupArn: webTg.arn }],
});

import * as aws from "@pulumi/aws";
import { prefix, rootDomain } from "../config";
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

export const frontendTg = new aws.lb.TargetGroup(`${prefix}-frontend-tg`, {
  name: `${prefix}-frontend-tg`,
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
  tags: { Name: `${prefix}-frontend-tg` },
});

export const backendTg = new aws.lb.TargetGroup(`${prefix}-backend-tg`, {
  name: `${prefix}-backend-tg`,
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
  tags: { Name: `${prefix}-backend-tg` },
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
    targetGroupArn: frontendTg.arn,
  }],
});

new aws.lb.ListenerRule(`${prefix}-frontend-rule`, {
  listenerArn: httpsListener.arn,
  priority: 100,
  conditions: [{ hostHeader: { values: ["heizen.tech"] } }],
  actions: [{ type: "forward", targetGroupArn: frontendTg.arn }],
});
new aws.lb.ListenerRule(`${prefix}-backend-rule`, {
  listenerArn: httpsListener.arn,
  priority: 200,
  conditions: [{ hostHeader: { values: ["api.heizen.tech"] } }],
  actions: [{ type: "forward", targetGroupArn: backendTg.arn }],
});


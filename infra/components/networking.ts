import * as aws from "@pulumi/aws";
import { prefix, region } from "../config";

export const vpc = new aws.ec2.Vpc(`${prefix}-vpc`, {
  cidrBlock: "10.0.0.0/16",
  enableDnsHostnames: true,
  enableDnsSupport: true,
  tags: { Name: `${prefix}-vpc` },
});

export const publicSubnet1 = new aws.ec2.Subnet(`${prefix}-public-1`, {
  vpcId: vpc.id,
  cidrBlock: "10.0.1.0/24",
  availabilityZone: `${region}a`,
  mapPublicIpOnLaunch: true,
  tags: { Name: `${prefix}-public-1` },
});

export const publicSubnet2 = new aws.ec2.Subnet(`${prefix}-public-2`, {
  vpcId: vpc.id,
  cidrBlock: "10.0.2.0/24",
  availabilityZone: `${region}b`,
  mapPublicIpOnLaunch: true,
  tags: { Name: `${prefix}-public-2` },
});

export const privateSubnet1 = new aws.ec2.Subnet(`${prefix}-private-1`, {
  vpcId: vpc.id,
  cidrBlock: "10.0.3.0/24",
  availabilityZone: `${region}a`,
  tags: { Name: `${prefix}-private-1` },
});

export const privateSubnet2 = new aws.ec2.Subnet(`${prefix}-private-2`, {
  vpcId: vpc.id,
  cidrBlock: "10.0.4.0/24",
  availabilityZone: `${region}b`,
  tags: { Name: `${prefix}-private-2` },
});

const igw = new aws.ec2.InternetGateway(`${prefix}-igw`, {
  vpcId: vpc.id,
  tags: { Name: `${prefix}-igw` },
});

const natEip1 = new aws.ec2.Eip(`${prefix}-nat-eip-1`, {
  domain: "vpc",
  tags: { Name: `${prefix}-nat-eip-1` },
});

const natGw1 = new aws.ec2.NatGateway(`${prefix}-nat-1`, {
  allocationId: natEip1.id,
  subnetId: publicSubnet1.id,
  tags: { Name: `${prefix}-nat-1` },
});


const publicRt = new aws.ec2.RouteTable(`${prefix}-public-rt`, {
  vpcId: vpc.id,
  routes: [{ cidrBlock: "0.0.0.0/0", gatewayId: igw.id }],
  tags: { Name: `${prefix}-public-rt` },
});

new aws.ec2.RouteTableAssociation(`${prefix}-public-rta-1`, {
  subnetId: publicSubnet1.id,
  routeTableId: publicRt.id,
});

new aws.ec2.RouteTableAssociation(`${prefix}-public-rta-2`, {
  subnetId: publicSubnet2.id,
  routeTableId: publicRt.id,
});

const privateRt = new aws.ec2.RouteTable(`${prefix}-private-rt`, {
  vpcId: vpc.id,
  routes: [{ cidrBlock: "0.0.0.0/0", natGatewayId: natGw1.id }],
  tags: { Name: `${prefix}-private-rt` },
});

new aws.ec2.RouteTableAssociation(`${prefix}-private-rta-1`, {
  subnetId: privateSubnet1.id,
  routeTableId: privateRt.id,
});

new aws.ec2.RouteTableAssociation(`${prefix}-private-rta-2`, {
  subnetId: privateSubnet2.id,
  routeTableId: privateRt.id,
});

export const albSg = new aws.ec2.SecurityGroup(`${prefix}-alb-sg`, {
  vpcId: vpc.id,
  description: "ALB - allows HTTP/HTTPS from internet",
  ingress: [
    { protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"] },
    { protocol: "tcp", fromPort: 443, toPort: 443, cidrBlocks: ["0.0.0.0/0"] },
  ],
  egress: [
    { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] },
  ],
  tags: { Name: `${prefix}-alb-sg` },
});

export const ecsSg = new aws.ec2.SecurityGroup(`${prefix}-ecs-sg`, {
  vpcId: vpc.id,
  description: "ECS - allows traffic from ALB only",
  ingress: [
    { protocol: "tcp", fromPort: 3000, toPort: 3001, securityGroups: [albSg.id] },
  ],
  egress: [
    { protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] },
  ],
  tags: { Name: `${prefix}-ecs-sg` },
});

export const rdsSg = new aws.ec2.SecurityGroup(`${prefix}-rds-sg`, {
  vpcId: vpc.id,
  description: "RDS - allows Postgres from ECS only",
  ingress: [
    { protocol: "tcp", fromPort: 5432, toPort: 5432, securityGroups: [ecsSg.id] },
  ],
  tags: { Name: `${prefix}-rds-sg` },
});


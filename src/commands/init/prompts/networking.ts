import { confirm, input, select } from "@inquirer/prompts";

import { NAT_PRESETS, NETWORKING_DEFAULTS } from "../../../schema/presets.js";
import type { HeizenConfig, NatMode } from "../../../schema/types.js";
import { box, dim, section } from "../../../ui/index.js";

type Networking = HeizenConfig["networking"];

export async function promptNetworking(region: string): Promise<Networking> {
  section("Networking");
  printDefaults(region);

  const nat = (await select({
    message: "NAT Gateway:",
    choices: [
      { name: `single - ${NAT_PRESETS.single.label} (~$${NAT_PRESETS.single.monthlyCost}/mo)`, value: "single" },
      { name: `dual   - ${NAT_PRESETS.dual.label} (~$${NAT_PRESETS.dual.monthlyCost}/mo)`, value: "dual" },
    ],
    default: "single",
  })) as NatMode;

  const customize = await confirm({ message: "Customize networking?", default: false });
  if (!customize) return { nat };

  dim("Override any CIDR. Press enter to keep the default.");
  return {
    nat,
    vpcCidr: await input({ message: "VPC CIDR:", default: NETWORKING_DEFAULTS.vpcCidr }),
    publicSubnet1Cidr: await input({ message: "Public subnet 1 CIDR:", default: NETWORKING_DEFAULTS.publicSubnet1Cidr }),
    publicSubnet2Cidr: await input({ message: "Public subnet 2 CIDR:", default: NETWORKING_DEFAULTS.publicSubnet2Cidr }),
    privateSubnet1Cidr: await input({ message: "Private subnet 1 CIDR:", default: NETWORKING_DEFAULTS.privateSubnet1Cidr }),
    privateSubnet2Cidr: await input({ message: "Private subnet 2 CIDR:", default: NETWORKING_DEFAULTS.privateSubnet2Cidr }),
  };
}

function printDefaults(region: string): void {
  dim("Using standard networking defaults:");
  console.log();
  box([
    `VPC:               ${NETWORKING_DEFAULTS.vpcCidr} (65,536 IPs)`,
    `Availability Zones: ${region}${NETWORKING_DEFAULTS.az1Suffix}, ${region}${NETWORKING_DEFAULTS.az2Suffix}`,
    "Public Subnets (ALB, NAT):",
    `  ${region}${NETWORKING_DEFAULTS.az1Suffix}: ${NETWORKING_DEFAULTS.publicSubnet1Cidr}`,
    `  ${region}${NETWORKING_DEFAULTS.az2Suffix}: ${NETWORKING_DEFAULTS.publicSubnet2Cidr}`,
    "Private Subnets (ECS, RDS, Redis):",
    `  ${region}${NETWORKING_DEFAULTS.az1Suffix}: ${NETWORKING_DEFAULTS.privateSubnet1Cidr}`,
    `  ${region}${NETWORKING_DEFAULTS.az2Suffix}: ${NETWORKING_DEFAULTS.privateSubnet2Cidr}`,
    "---",
    "Security Groups:",
    "  ALB:   ports 80, 443 from internet",
    "  ECS:   service ports from ALB only",
    "  RDS:   port 5432 from ECS only",
    "  Redis: port 6379 from ECS only",
  ]);
  console.log();
}

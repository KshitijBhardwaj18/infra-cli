import { execa } from "execa";

import type { PulumiCtx } from "../../pulumi/index.js";
import type { HeizenConfig } from "../../schema/types.js";
import { info, section } from "../../ui/index.js";

interface CertValidation {
  resourceRecordName: string;
  resourceRecordValue: string;
}

interface StackOutputs {
  albDns?: string;
  dbEndpoint?: string;
  redisEndpoint?: string;
  bucketName?: string;
  certValidation?: CertValidation[];
}

export async function fetchStackOutputs(pCtx: PulumiCtx): Promise<StackOutputs> {
  try {
    const { stdout } = await execa("pulumi", ["stack", "output", "--json"], pCtx);
    return JSON.parse(stdout) as StackOutputs;
  } catch {
    return {};
  }
}

export function printOutputs(outputs: StackOutputs): void {
  section("Outputs");
  if (outputs.albDns) console.log(`  ALB DNS:         ${outputs.albDns}`);
  if (outputs.dbEndpoint) console.log(`  DB Endpoint:     ${outputs.dbEndpoint}`);
  if (outputs.redisEndpoint) console.log(`  Redis Endpoint:  ${outputs.redisEndpoint}`);
  if (outputs.bucketName) console.log(`  S3 Bucket:       ${outputs.bucketName}`);
}

export function printDnsRecords(cfg: HeizenConfig, outputs: StackOutputs): void {
  const withDomain = cfg.services.filter((s) => s.domain);
  if (withDomain.length === 0 || !outputs.albDns) return;

  section("DNS Records (add to your DNS provider)");
  for (const svc of withDomain) {
    console.log(`  ${svc.domain} → CNAME → ${outputs.albDns}`);
    if (svc.wildcard) console.log(`  *.${cfg.domain} → CNAME → ${outputs.albDns}`);
  }
}

export function printCertValidation(outputs: StackOutputs): void {
  const records = outputs.certValidation;
  if (!records || records.length === 0) return;

  section("SSL Certificate Validation");
  console.log("  Add this CNAME record to validate the certificate:");
  for (const v of records) {
    console.log(`  ${v.resourceRecordName} → ${v.resourceRecordValue}`);
  }
  console.log();
  info("HTTPS will work after DNS records are added (~5 minutes).");
}

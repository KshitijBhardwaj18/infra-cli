import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { execa, ExecaError } from "execa";
import ora from "ora";
import chalk from "chalk";
import { password } from "@inquirer/prompts";
import { validateConfig, validateEnvConfig, pulumiKeyFromEnvVar } from "../schema/validator.js";
import { readConfig, readEnvConfig, readLocalSecrets } from "../files.js";
import { section, success, failure, info, nextSteps } from "../ui.js";
const DEFAULT_PASSPHRASE = "heizen-managed-passphrase";
export async function runDeploy() {
    const cwd = process.cwd();
    const infraDir = resolve(cwd, "infra");
    const rawCfg = readConfig(cwd);
    if (!rawCfg) {
        failure("heizen.yaml not found. Run 'heizen infra init' first.");
        process.exit(1);
    }
    const rawEnv = readEnvConfig(cwd);
    if (!rawEnv) {
        failure("heizen.env.yaml not found. Run 'heizen infra init --env-only' first.");
        process.exit(1);
    }
    if (!existsSync(infraDir)) {
        failure("infra/ directory not found. Run 'heizen infra generate' first.");
        process.exit(1);
    }
    const cfg = validateConfig(rawCfg);
    const envCfg = validateEnvConfig(rawEnv);
    const passphrase = process.env.PULUMI_CONFIG_PASSPHRASE ?? DEFAULT_PASSPHRASE;
    const stateBucket = `${cfg.project}-pulumi-state`;
    section(`Deploying ${cfg.project} (${cfg.env})`);
    console.log(`  Region:  ${cfg.region}`);
    console.log(`  Profile: ${envCfg.awsProfile}`);
    console.log();
    const credSpinner = ora("Checking AWS credentials...").start();
    try {
        const { stdout } = await execa("aws", ["sts", "get-caller-identity", "--profile", envCfg.awsProfile, "--output", "json"]);
        const id = JSON.parse(stdout);
        credSpinner.succeed(`Authenticated as ${id.Arn} (account: ${id.Account})`);
    }
    catch {
        credSpinner.fail(`AWS credentials not configured. Run 'aws configure --profile ${envCfg.awsProfile}'`);
        process.exit(1);
    }
    await setupStateBucket(cfg, envCfg, stateBucket);
    const pCtx = {
        env: {
            ...process.env,
            PULUMI_CONFIG_PASSPHRASE: passphrase,
            AWS_PROFILE: envCfg.awsProfile,
        },
        cwd: infraDir,
    };
    try {
        await execa("pulumi", ["login", `s3://${stateBucket}`], pCtx);
        success("Connected to Pulumi backend");
    }
    catch (err) {
        failure("Failed to connect to Pulumi state backend");
        console.log(formatExecError(err));
        process.exit(1);
    }
    try {
        const { stdout } = await execa("pulumi", ["stack", "ls"], pCtx);
        const hasStack = stdout.split("\n").some((l) => l.trim().startsWith(cfg.env));
        if (!hasStack) {
            await execa("pulumi", ["stack", "init", cfg.env], pCtx);
        }
        else {
            await execa("pulumi", ["stack", "select", cfg.env], pCtx);
        }
        success(`Stack: ${cfg.env}`);
    }
    catch (err) {
        failure("Failed to set up Pulumi stack");
        console.log(formatExecError(err));
        process.exit(1);
    }
    await execa("pulumi", ["config", "set", "aws:region", cfg.region], pCtx);
    console.log();
    section("Secrets");
    await provisionSecrets(envCfg.secrets, pCtx);
    console.log();
    console.log();
    info("Starting deployment... This typically takes 15-20 minutes.");
    console.log();
    console.log("  Creating:");
    console.log("  • VPC, Subnets, NAT Gateway, Internet Gateway");
    console.log("  • Security Groups (ALB → ECS → RDS → Redis)");
    if (cfg.services.some((s) => s.domain)) {
        console.log("  • Application Load Balancer, Target Groups, Routing Rules");
        console.log(`  • ACM Certificate (*.${cfg.domain})`);
    }
    if (cfg.database.engine === "postgres")
        console.log(`  • RDS PostgreSQL (${cfg.database.size})`);
    if (cfg.cache.engine === "redis")
        console.log(`  • ElastiCache Redis (${cfg.cache.size})`);
    if (cfg.storage.enabled)
        console.log("  • S3 Bucket");
    console.log(`  • ECS Cluster, ${cfg.services.length} Service(s), Auto-scaling`);
    console.log("  • CloudWatch Log Groups, IAM Roles");
    console.log();
    try {
        await execa("pulumi", ["up", "--yes", "--non-interactive"], {
            ...pCtx, stdio: "inherit",
        });
    }
    catch (err) {
        failure("Deployment failed");
        console.log(chalk.dim(formatExecError(err)));
        console.log();
        console.log("Fix the error and run 'heizen infra deploy' again");
        console.log("Or run 'cd infra && pulumi up' to retry interactively");
        process.exit(1);
    }
    success("Infrastructure deployed successfully!");
    let outputs = {};
    try {
        const { stdout } = await execa("pulumi", ["stack", "output", "--json"], pCtx);
        outputs = JSON.parse(stdout);
    }
    catch { }
    section("Outputs");
    if (outputs.albDns)
        console.log(`  ALB DNS:         ${outputs.albDns}`);
    if (outputs.dbEndpoint)
        console.log(`  DB Endpoint:     ${outputs.dbEndpoint}`);
    if (outputs.redisEndpoint)
        console.log(`  Redis Endpoint:  ${outputs.redisEndpoint}`);
    if (outputs.bucketName)
        console.log(`  S3 Bucket:       ${outputs.bucketName}`);
    const servicesWithDomain = cfg.services.filter((s) => s.domain);
    if (servicesWithDomain.length > 0 && outputs.albDns) {
        section("DNS Records (add to your DNS provider)");
        for (const svc of servicesWithDomain) {
            console.log(`  ${svc.domain} → CNAME → ${outputs.albDns}`);
            if (svc.wildcard)
                console.log(`  *.${cfg.domain} → CNAME → ${outputs.albDns}`);
        }
    }
    if (outputs.certValidation && Array.isArray(outputs.certValidation) && outputs.certValidation.length > 0) {
        section("SSL Certificate Validation");
        console.log("  Add this CNAME record to validate the certificate:");
        for (const v of outputs.certValidation) {
            console.log(`  ${v.resourceRecordName} → ${v.resourceRecordValue}`);
        }
        console.log();
        info("HTTPS will work after DNS records are added (~5 minutes).");
    }
    const firstDomain = servicesWithDomain[0]?.domain;
    nextSteps([
        "Add the DNS records above to your DNS provider",
        `Push a Docker image: docker push ${cfg.ecr.image}:${cfg.ecr.tag}`,
        firstDomain ? `Verify: curl https://${firstDomain}` : "Confirm services are healthy in the ECS console",
    ]);
}
async function setupStateBucket(cfg, envCfg, stateBucket) {
    const stateSpinner = ora("Setting up Pulumi state backend...").start();
    try {
        await execa("aws", ["s3api", "head-bucket", "--bucket", stateBucket, "--profile", envCfg.awsProfile], { stderr: "ignore" });
        stateSpinner.succeed(`Using existing state bucket: ${stateBucket}`);
        return;
    }
    catch { }
    stateSpinner.text = `Creating state bucket: ${stateBucket}`;
    try {
        const mbArgs = ["s3", "mb", `s3://${stateBucket}`, "--profile", envCfg.awsProfile];
        if (cfg.region !== "us-east-1")
            mbArgs.push("--region", cfg.region);
        await execa("aws", mbArgs);
        await execa("aws", [
            "s3api", "put-bucket-versioning",
            "--bucket", stateBucket,
            "--versioning-configuration", "Status=Enabled",
            "--profile", envCfg.awsProfile,
        ]);
        stateSpinner.succeed(`State bucket created: ${stateBucket}`);
    }
    catch (err) {
        stateSpinner.fail(`Failed to create state bucket`);
        console.log(formatExecError(err));
        process.exit(1);
    }
}
async function provisionSecrets(secrets, pCtx) {
    if (secrets.length === 0) {
        info("No secrets declared.");
        return;
    }
    const localOverrides = readLocalSecrets();
    for (const spec of secrets) {
        const pulumiKey = pulumiKeyFromEnvVar(spec.envVar);
        if (await pulumiConfigExists(pulumiKey, pCtx)) {
            success(`${spec.envVar} (already configured)`);
            continue;
        }
        let value;
        let source = "";
        if (process.env[`HEIZEN_SECRET_${spec.envVar}`]) {
            value = process.env[`HEIZEN_SECRET_${spec.envVar}`];
            source = `HEIZEN_SECRET_${spec.envVar} env var`;
        }
        else if (localOverrides[spec.envVar]) {
            value = localOverrides[spec.envVar];
            source = ".heizen.secrets";
        }
        else if (spec.value) {
            value = spec.value;
            source = "heizen.env.yaml";
        }
        else if (spec.generate) {
            value = randomBytes(32).toString("hex");
            source = "generated";
        }
        else {
            console.log();
            info(`Secret "${spec.name}" (${spec.envVar}) needs a value.`);
            value = await password({
                message: `Value for ${spec.envVar}:`,
                mask: "*",
                validate: (v) => v.length > 0 || "A value is required.",
            });
            source = "prompted";
        }
        await execa("pulumi", ["config", "set", "--secret", pulumiKey, value], pCtx);
        success(`Set ${spec.envVar} in Pulumi config (${source})`);
    }
}
async function pulumiConfigExists(key, pCtx) {
    try {
        await execa("pulumi", ["config", "get", key], { ...pCtx, stderr: "ignore" });
        return true;
    }
    catch {
        return false;
    }
}
function formatExecError(err) {
    if (err instanceof ExecaError) {
        return (err.stderr || err.stdout || err.message || "").toString();
    }
    return err instanceof Error ? err.message : String(err);
}
//# sourceMappingURL=deploy.js.map
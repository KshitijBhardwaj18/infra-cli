import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execa, ExecaError } from "execa";
import yaml from "js-yaml";
import ora from "ora";
import chalk from "chalk";
import { input, confirm } from "@inquirer/prompts";
import { validateConfig } from "../schema/validator.js";
import { failure, success, warn, warnBox } from "../ui.js";
const DEFAULT_PASSPHRASE = "heizen-managed-passphrase";
export async function runDestroy() {
    const cwd = process.cwd();
    const yamlPath = resolve(cwd, "heizen.yaml");
    const infraDir = resolve(cwd, "infra");
    if (!existsSync(yamlPath)) {
        failure("heizen.yaml not found. Run 'heizen infra init' first.");
        process.exit(1);
    }
    if (!existsSync(infraDir)) {
        failure("infra/ directory not found.");
        process.exit(1);
    }
    const cfg = validateConfig(yaml.load(readFileSync(yamlPath, "utf8")));
    const passphrase = process.env.PULUMI_CONFIG_PASSPHRASE ?? DEFAULT_PASSPHRASE;
    const stateBucket = `${cfg.project}-pulumi-state`;
    const warningLines = [
        "                    WARNING",
        "---",
        "This will permanently destroy ALL infrastructure",
        `for project '${cfg.project}' (${cfg.env})`,
        "",
        "Resources to be destroyed:",
        "  • VPC, Subnets, NAT Gateway",
    ];
    if (cfg.services.some((s) => s.domain)) {
        warningLines.push("  • Load Balancer, Target Groups");
    }
    warningLines.push("  • ECS Cluster, all services");
    if (cfg.database.engine === "postgres") {
        warningLines.push("  • RDS Database (ALL DATA WILL BE LOST)");
    }
    if (cfg.cache.engine === "redis")
        warningLines.push("  • Redis Cache");
    if (cfg.storage.enabled)
        warningLines.push("  • S3 Bucket and all contents");
    warningLines.push("  • Secrets, Logs, IAM Roles");
    warningLines.push("");
    warningLines.push("This action CANNOT be undone.");
    console.log();
    warnBox(warningLines);
    console.log();
    const typed = await input({ message: `Type the project name to confirm:` });
    if (typed !== cfg.project) {
        failure("Project name doesn't match. Aborting.");
        process.exit(1);
    }
    if (cfg.database.engine === "postgres" && cfg.database.deletionProtection) {
        console.log();
        warn("RDS has deletion protection enabled.");
        const proceed = await confirm({
            message: "Temporarily disable deletion protection to proceed?",
            default: false,
        });
        if (!proceed) {
            console.log("Aborting. Disable deletion protection manually or set deletionProtection: false in heizen.yaml");
            process.exit(0);
        }
        const spinner = ora("Disabling RDS deletion protection...").start();
        try {
            await execa("aws", [
                "rds", "modify-db-instance",
                "--db-instance-identifier", `${cfg.project}-${cfg.env}-db`,
                "--no-deletion-protection",
                "--apply-immediately",
                "--profile", cfg.awsProfile,
                "--region", cfg.region,
            ]);
            spinner.succeed("Deletion protection disabled");
        }
        catch (err) {
            spinner.fail("Failed to disable deletion protection");
            console.log(formatExecError(err));
            process.exit(1);
        }
    }
    const env = {
        ...process.env,
        PULUMI_CONFIG_PASSPHRASE: passphrase,
        AWS_PROFILE: cfg.awsProfile,
    };
    try {
        await execa("pulumi", ["login", `s3://${stateBucket}`], { env, cwd: infraDir });
        await execa("pulumi", ["stack", "select", cfg.env], { env, cwd: infraDir });
    }
    catch (err) {
        failure("Failed to connect to Pulumi state backend");
        console.log(formatExecError(err));
        process.exit(1);
    }
    try {
        await execa("pulumi", ["destroy", "--yes", "--non-interactive"], {
            env, cwd: infraDir, stdio: "inherit",
        });
    }
    catch (err) {
        failure("Destroy failed");
        console.log(chalk.dim(formatExecError(err)));
        console.log();
        console.log("Some resources may not have been destroyed. Check the AWS Console.");
        console.log("Run 'heizen infra destroy' again or manually delete remaining resources.");
        process.exit(1);
    }
    success("Infrastructure destroyed.");
    const deleteBucket = await confirm({
        message: `Delete Pulumi state bucket (${stateBucket})?`,
        default: false,
    });
    if (deleteBucket) {
        const spinner = ora(`Deleting ${stateBucket}...`).start();
        try {
            await execa("aws", [
                "s3", "rb", `s3://${stateBucket}`, "--force",
                "--profile", cfg.awsProfile, "--region", cfg.region,
            ]);
            spinner.succeed("State bucket deleted");
        }
        catch (err) {
            spinner.fail("Could not delete state bucket (delete manually if needed)");
        }
    }
    console.log();
    console.log("Cleanup complete. All resources have been destroyed.");
}
function formatExecError(err) {
    if (err instanceof ExecaError) {
        return (err.stderr || err.stdout || err.message || "").toString();
    }
    return err instanceof Error ? err.message : String(err);
}
//# sourceMappingURL=destroy.js.map
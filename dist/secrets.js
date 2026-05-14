import { randomBytes } from "node:crypto";
import { execa, ExecaError } from "execa";
import { password } from "@inquirer/prompts";
import ora from "ora";
import { readLocalSecrets } from "./files.js";
import { success, info, warn, failure } from "./ui.js";
export async function resolveAndProvisionSecrets(cfg, envCfg) {
    const ctx = {
        prefix: `${cfg.project}-${cfg.env}`,
        region: cfg.region,
        awsProfile: envCfg.awsProfile,
    };
    const local = readLocalSecrets();
    info("Resolving secrets...");
    for (const spec of envCfg.secrets.generated) {
        await provisionGenerated(spec, ctx);
    }
    for (const spec of envCfg.secrets.manual) {
        await provisionManual(spec, ctx, local);
    }
}
async function provisionGenerated(spec, ctx) {
    const fullName = `${ctx.prefix}/${spec.name}`;
    if (await secretExists(fullName, ctx)) {
        success(`${spec.name} (already in Secrets Manager)`);
        return;
    }
    const value = generateRandomValue();
    await createSecret(fullName, value, ctx);
    success(`${spec.name} (generated and stored)`);
}
async function provisionManual(spec, ctx, local) {
    const fullName = `${ctx.prefix}/${spec.name}`;
    if (await secretExists(fullName, ctx)) {
        success(`${spec.name} (already in Secrets Manager)`);
        return;
    }
    const envVarName = `HEIZEN_SECRET_${spec.envVar}`;
    const fromEnv = process.env[envVarName];
    if (fromEnv) {
        await createSecret(fullName, fromEnv, ctx);
        success(`${spec.name} (loaded from ${envVarName})`);
        return;
    }
    const fromFile = local[spec.envVar];
    if (fromFile) {
        await createSecret(fullName, fromFile, ctx);
        success(`${spec.name} (loaded from .heizen.secrets)`);
        return;
    }
    warn(`${spec.name} is required. Provide its value below (input is masked).`);
    const value = await password({
        message: `Value for ${spec.envVar}:`,
        mask: "*",
        validate: (v) => v.length > 0 || "A value is required.",
    });
    await createSecret(fullName, value, ctx);
    success(`${spec.name} (prompted and stored)`);
}
async function secretExists(fullName, ctx) {
    try {
        await execa("aws", [
            "secretsmanager", "describe-secret",
            "--secret-id", fullName,
            "--profile", ctx.awsProfile,
            "--region", ctx.region,
        ], { stderr: "ignore" });
        return true;
    }
    catch {
        return false;
    }
}
async function createSecret(fullName, value, ctx) {
    const spinner = ora(`Storing ${fullName}...`).start();
    try {
        await execa("aws", [
            "secretsmanager", "create-secret",
            "--name", fullName,
            "--secret-string", value,
            "--profile", ctx.awsProfile,
            "--region", ctx.region,
        ]);
        spinner.stop();
    }
    catch (err) {
        spinner.stop();
        if (err instanceof ExecaError && (err.stderr ?? "").toString().includes("ResourceExistsException")) {
            return;
        }
        failure(`Could not create secret ${fullName}`);
        throw err;
    }
}
export async function deleteAllProjectSecrets(cfg, awsProfile) {
    const prefix = `${cfg.project}-${cfg.env}/`;
    const deleted = [];
    const { stdout } = await execa("aws", [
        "secretsmanager", "list-secrets",
        "--profile", awsProfile,
        "--region", cfg.region,
        "--output", "json",
    ]);
    const list = JSON.parse(stdout);
    for (const s of list.SecretList ?? []) {
        if (!s.Name.startsWith(prefix))
            continue;
        try {
            await execa("aws", [
                "secretsmanager", "delete-secret",
                "--secret-id", s.Name,
                "--force-delete-without-recovery",
                "--profile", awsProfile,
                "--region", cfg.region,
            ]);
            deleted.push(s.Name);
        }
        catch { }
    }
    return deleted;
}
function generateRandomValue() {
    return randomBytes(32).toString("hex");
}
//# sourceMappingURL=secrets.js.map
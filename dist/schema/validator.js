export function validateConfig(raw) {
    if (!raw || typeof raw !== "object") {
        throw new Error("heizen.yaml is empty or invalid");
    }
    const c = raw;
    const required = ["project", "env", "region", "domain", "ecr", "services", "database", "cache", "storage", "networking"];
    for (const key of required) {
        if (c[key] === undefined)
            throw new Error(`heizen.yaml missing required field: ${key}`);
    }
    if (!Array.isArray(c.services) || c.services.length === 0) {
        throw new Error("heizen.yaml must declare at least one service");
    }
    for (const svc of c.services) {
        if (!svc.name || !svc.type || !svc.cpu || !svc.scaling || !svc.command) {
            throw new Error(`Service "${svc?.name ?? "?"}" is missing required fields`);
        }
        if ((svc.type === "backend" || svc.type === "frontend") && !svc.port) {
            throw new Error(`Service "${svc.name}" (${svc.type}) must declare a port`);
        }
    }
    if (!c.ecr.image || !c.ecr.tag) {
        throw new Error("heizen.yaml: ecr.image and ecr.tag are required");
    }
    return c;
}
export function validateEnvConfig(raw) {
    if (!raw || typeof raw !== "object") {
        throw new Error("heizen.env.yaml is empty or invalid");
    }
    const c = raw;
    if (!c.awsProfile)
        throw new Error("heizen.env.yaml missing awsProfile");
    if (!c.secrets)
        c.secrets = { generated: [], manual: [] };
    if (!Array.isArray(c.secrets.generated))
        c.secrets.generated = [];
    if (!Array.isArray(c.secrets.manual))
        c.secrets.manual = [];
    if (!c.env || typeof c.env !== "object")
        c.env = {};
    return c;
}
export function isKebabCase(value) {
    return /^[a-z][a-z0-9-]*[a-z0-9]$/.test(value);
}
export function isValidDomain(value) {
    return /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(value);
}
export function suggestEnvVar(secretName) {
    return secretName.replace(/-/g, "_").toUpperCase();
}
export function isValidEnvVar(value) {
    return /^[A-Z_][A-Z0-9_]*$/.test(value);
}
//# sourceMappingURL=validator.js.map
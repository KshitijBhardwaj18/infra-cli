import { SecretsClient } from "@heizen-labs/secrets-sdk";

const client = new SecretsClient({
  projectId: process.env.HEIZEN_STUDIO_PROJECT_ID,
  environment: process.env.HEIZEN_STUDIO_ENV,
  apiKey: process.env.HEIZEN_STUDIO_API_KEY ?? "",
});

const secrets = await client.getSecrets();
console.log(secrets);

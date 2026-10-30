const { IDaaSCredentialProviderFactory } = require('@cloud-idaas/core-sdk');
const { createTencentCloudCredentialsProvider } = require('@cloud-idaas/akless-tencent-adapter');

async function main() {
  await IDaaSCredentialProviderFactory.init();
  try {
    const provider = createTencentCloudCredentialsProvider(
      process.env.IDAAS_ROLE_EXTERNAL_ID || 'role-id',
    );
    try {
      await provider.getCredential();
    } finally {
      provider.close();
    }
  } finally {
    await IDaaSCredentialProviderFactory.close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'SDK call failed');
  process.exitCode = 1;
});

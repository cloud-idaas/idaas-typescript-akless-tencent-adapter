# IDaaS Tencent Cloud Credentials Adapter

[Simplified Chinese](README_zh.md) | English

Use IDaaS PAM temporary credentials with the Tencent Cloud SDK and COS.

## Requirements and installation

Supports Node.js 20, 22, and 24, JavaScript CommonJS/ESM, and TypeScript 4.7 or later. This is a Node.js SDK, not a browser SDK. Check your registry for available beta versions; use a provided package archive when evaluating an unreleased version.

```sh
npm install @cloud-idaas/core-sdk @cloud-idaas/akless-tencent-adapter
```

## Usage

Configure Core using CLOUD_IDAAS_CONFIG_PATH or ~/.cloud_idaas/client-config.json. Provide developerApiEndpoint and an identity authorized for PAM access. Replace example identifiers with your settings. Save the following ESM example as `example.mjs` and run it with Node.js. CommonJS uses the same named exports through `require`; asynchronous calls belong inside an async function.

```javascript
import { IDaaSCredentialProviderFactory } from '@cloud-idaas/core-sdk';
import {
  createTencentCloudCredentialsProvider,
  createTencentCloudCOSCredentialsProvider,
} from '@cloud-idaas/akless-tencent-adapter';

await IDaaSCredentialProviderFactory.init();
try {
  const credential = createTencentCloudCredentialsProvider('role-external-id');
  try {
    await credential.getCredential();
    // Pass credential to new TencentClient({ credential, region: '...' }).
    const getAuthorization = createTencentCloudCOSCredentialsProvider('role-external-id');
    try {
      // Pass getAuthorization to new COS({ getAuthorization }).
      // Await all COS requests before closing this callback's provider.
    } finally {
      getAuthorization.close();
    }
  } finally {
    credential.close();
  }
} finally {
  await IDaaSCredentialProviderFactory.close();
}
```

## Integration notes

Use `createTencentCloudCredentialsProvider()` for the Tencent Cloud SDK credential interface, or pass `createTencentCloudCOSCredentialsProvider()` to COS as `getAuthorization`. Install the official service client needed by your application separately.

Direct credential methods reject with SDK errors when credentials cannot be obtained. COS users can provide `onError` for SDK diagnostics; failures can also surface through the service client's error handling. Keep providers open until all service requests finish, then call their `close()` methods.

Configuration supports `roleExternalId`, `developerApiEndpoint`, `idaasInstanceId`, and `credentialProvider`. `httpConfiguration.userAgent` customizes requests to IDaaS; cloud-service requests follow their official client's configuration.

## Examples and support

See [examples](examples) for CommonJS, ESM, and TypeScript samples. Report issues through [GitHub Issues](https://github.com/cloud-idaas/idaas-typescript-akless-tencent-adapter/issues). Development instructions are in the repository's [contribution guide](https://github.com/cloud-idaas/idaas-typescript-akless-tencent-adapter/blob/master/CONTRIBUTING.md).

## License

[Apache License 2.0](LICENSE).

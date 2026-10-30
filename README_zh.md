# IDaaS Tencent Cloud Credentials Adapter

简体中文 | [English](README.md)

将 IDaaS PAM 临时凭证用于腾讯云 SDK 和 COS。

## 环境与安装

支持 Node.js 20、22、24，JavaScript CommonJS/ESM 以及 TypeScript 4.7 及以上版本。本 SDK 用于 Node.js，不用于浏览器。请以 npm registry 中的实际可用版本为准；评估尚未发布的版本时，使用提供的安装包归档。

```sh
npm install @cloud-idaas/core-sdk @cloud-idaas/akless-tencent-adapter
```

## 使用

通过 CLOUD_IDAAS_CONFIG_PATH 或 ~/.cloud_idaas/client-config.json 配置 Core，提供 developerApiEndpoint 及已获 PAM 访问授权的身份，并替换示例标识。 将以下 ESM 示例保存为 `example.mjs`，通过 Node.js 运行。CommonJS 使用相同的具名导出和 `require`，异步调用放在 async 函数中。

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

## 集成说明

腾讯云 SDK 凭证接口使用 `createTencentCloudCredentialsProvider()`，COS 的 `getAuthorization` 选项使用 `createTencentCloudCOSCredentialsProvider()`。请另行安装应用需要的官方服务客户端。

无法获取凭证时，直接取凭证的方法会以 SDK 异常拒绝。COS 使用者可通过 `onError` 获取 SDK 诊断，失败也可能由服务客户端的错误处理通道返回。所有服务请求完成前保持提供者可用，随后调用各自的 `close()`。

配置支持 `roleExternalId`、`developerApiEndpoint`、`idaasInstanceId` 和 `credentialProvider`。`httpConfiguration.userAgent` 定制发往 IDaaS 的请求；云服务请求遵循其官方客户端配置。

## 示例与支持

[examples](examples) 提供 CommonJS、ESM 和 TypeScript 示例。问题反馈请使用 [GitHub Issues](https://github.com/cloud-idaas/idaas-typescript-akless-tencent-adapter/issues)，开发说明见源码仓库的[贡献指南](https://github.com/cloud-idaas/idaas-typescript-akless-tencent-adapter/blob/master/CONTRIBUTING.md)。

## 许可证

[Apache License 2.0](LICENSE)。

import { strict as assert } from 'node:assert';
import { IDaaSPamTencentCloudCredentialsProvider } from '../src';
import COS from 'cos-nodejs-sdk-v5';
const quiet = { info() {}, warn() {}, error() {} };
describe('Tencent Cloud SDK and COS dynamic credentials', () => {
  it('completes operations on credential retrieval failure with a real COS client', async () => {
    let observed = 0;
    const provider = new IDaaSPamTencentCloudCredentialsProvider({
      roleExternalId: 'role',
      cache: { logger: quiet },
      pamClient: {
        async obtainAccessCredential() {
          throw new Error('down');
        },
      },
    });
    const client = new COS({
      getAuthorization: provider.toCOSGetAuthorization(() => {
        observed++;
      }),
      Timeout: 1000,
    });
    await assert.rejects(client.getBucket({ Bucket: 'test-1250000000', Region: 'ap-guangzhou' }));
    assert.equal(observed, 1);
    provider.close();
  });
  it('maps wire tmpSecret fields to Tencent Cloud SDK and COS names', async () => {
    let calls = 0;
    const provider = new IDaaSPamTencentCloudCredentialsProvider({
      roleExternalId: 'role',
      cache: { logger: quiet },
      pamClient: {
        async obtainAccessCredential() {
          calls++;
          return {
            tencentCloudStsToken: {
              tmpSecretId: 'id',
              tmpSecretKey: 'key',
              token: 'session',
              expiration: new Date(Date.now() + 3600_000).toISOString(),
            },
          };
        },
      },
    });
    assert.deepEqual(await provider.getCredential(), {
      secretId: 'id',
      secretKey: 'key',
      token: 'session',
    });
    await new Promise<void>((resolve) =>
      provider.toCOSGetAuthorization()({}, (value) => {
        assert.equal(value.TmpSecretId, 'id');
        assert.equal(value.SecurityToken, 'session');
        assert.equal(value.StartTime, 0);
        assert(value.ExpiredTime > Date.now() / 1000);
        resolve();
      }),
    );
    assert.equal(calls, 1);
    provider.close();
  });
  it('completes COS failures through the callback and preserves classified errors for the observer', async () => {
    let failures = 0;
    let callbacks = 0;
    const provider = new IDaaSPamTencentCloudCredentialsProvider({
      roleExternalId: 'role',
      cache: { logger: quiet },
      pamClient: {
        async obtainAccessCredential() {
          throw new Error('network-private');
        },
      },
    });
    await new Promise<void>((resolve) =>
      provider.toCOSGetAuthorization((error) => {
        failures++;
        assert(!error.message.includes('network-private'));
      })({}, (value) => {
        callbacks++;
        assert.equal(value.TmpSecretId, '');
        assert.equal(value.ExpiredTime, 0);
        resolve();
      }),
    );
    assert.equal(failures, 1);
    assert.equal(callbacks, 1);
    provider.close();
  });
});

declare module "tls-sig-api-v2" {
  interface UserSigApi {
    genUserSig(userId: string, expireSeconds: number): string;
  }

  interface UserSigModule {
    Api: new (sdkAppId: number, secretKey: string) => UserSigApi;
  }

  const userSigModule: UserSigModule;
  export default userSigModule;
}

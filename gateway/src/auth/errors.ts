export class SignInError extends Error {
  readonly statusCode = 401;

  constructor(readonly reason: string) {
    super("Sign-in failed");
    this.name = "SignInError";
  }
}

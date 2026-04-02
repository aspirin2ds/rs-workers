import type { FC, PropsWithChildren } from "hono/jsx";
import styles from "../generated/styles.css";

export type ClientInfo = { clientId: string; clientName?: string; clientUri?: string } | null;

export type PageProps =
  | { step: "login"; state: string; clientInfo: ClientInfo; error?: string }
  | { step: "signup"; state: string; clientInfo: ClientInfo; error?: string }
  | { step: "otp"; state: string; clientInfo: ClientInfo; email: string; name?: string; error?: string }
  | {
      step: "consent";
      state: string;
      clientInfo: ClientInfo;
      user: { id: string; email: string; name: string | null; role?: string | null };
    };

const tabScript = `
function setAuthMode(name) {
  var root = document.documentElement;
  if (root) root.dataset.authMode = name;
}
`;

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

const ErrorBanner: FC<{ error?: string }> = ({ error }) =>
  error ? (
    <div class="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {error}
    </div>
  ) : null;

const HiddenStateFields: FC<{ state: string; action: string }> = ({ state, action }) => (
  <>
    <input type="hidden" name="state" value={state} />
    <input type="hidden" name="action" value={action} />
  </>
);

const Card: FC<PropsWithChildren> = ({ children }) => (
  <section class="w-full max-w-md rounded-2xl border border-border/70 bg-card/95 p-6 shadow-2xl shadow-black/10 backdrop-blur">
    {children}
  </section>
);

const CardHeader: FC<PropsWithChildren> = ({ children }) => <div class="space-y-2">{children}</div>;

const CardTitle: FC<PropsWithChildren> = ({ children }) => (
  <h1 class="text-2xl font-semibold tracking-tight text-foreground">{children}</h1>
);

const CardDescription: FC<PropsWithChildren> = ({ children }) => (
  <p class="text-sm leading-6 text-muted-foreground">{children}</p>
);

const CardContent: FC<PropsWithChildren> = ({ children }) => <div class="mt-6 space-y-5">{children}</div>;

const Button: FC<
  PropsWithChildren<{
    type?: "button" | "submit";
    variant?: "default" | "outline" | "ghost";
    class?: string;
    onclick?: string;
  }>
> = ({ type = "button", variant = "default", class: className, onclick, children }) => (
  <button
    type={type}
    onclick={onclick}
    class={cn(
      "inline-flex h-10 w-full items-center justify-center rounded-md px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
      variant === "default" && "bg-primary text-primary-foreground hover:bg-primary/90",
      variant === "outline" && "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
      variant === "ghost" && "hover:bg-accent hover:text-accent-foreground",
      className
    )}
  >
    {children}
  </button>
);

const Input: FC<{
  id: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  autocomplete?: string;
  value?: string;
  inputMode?: string;
  pattern?: string;
  maxLength?: number;
}> = ({ type = "text", ...props }) => (
  <input
    {...props}
    type={type}
    class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
  />
);

const Label: FC<PropsWithChildren<{ for: string }>> = ({ for: htmlFor, children }) => (
  <label for={htmlFor} class="text-sm font-medium text-foreground">
    {children}
  </label>
);

const FormField: FC<PropsWithChildren<{ id: string; label: string }>> = ({ id, label, children }) => (
  <div class="grid gap-2">
    <Label for={id}>{label}</Label>
    {children}
  </div>
);

const Divider: FC<{ label: string }> = ({ label }) => (
  <div class="relative">
    <div class="absolute inset-0 flex items-center">
      <span class="w-full border-t border-border" />
    </div>
    <div class="relative flex justify-center text-xs uppercase">
      <span class="bg-card px-2 text-muted-foreground">{label}</span>
    </div>
  </div>
);

const MetaRow: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div class="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm">
    <span class="text-muted-foreground">{label}</span>
    <span class="max-w-[14rem] truncate font-medium text-foreground">{value}</span>
  </div>
);

const GoogleMark: FC = () => (
  <svg aria-hidden="true" class="h-4 w-4 shrink-0" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <path
      fill="#4285F4"
      d="M17.64 9.2045c0-.6382-.0573-1.2518-.1636-1.8409H9v3.4818h4.8436c-.2086 1.125-.8427 2.0795-1.7959 2.7181v2.2586h2.9086c1.7018-1.5668 2.6837-3.8749 2.6837-6.6176Z"
    />
    <path
      fill="#34A853"
      d="M9 18c2.43 0 4.4673-.8068 5.9564-2.1786l-2.9086-2.2586c-.8068.54-1.8409.8591-3.0477.8591-2.3441 0-4.3282-1.5827-5.0359-3.7104H.9573v2.3323A8.9988 8.9988 0 0 0 9 18Z"
    />
    <path
      fill="#FBBC05"
      d="M3.9641 10.7115A5.4108 5.4108 0 0 1 3.6823 9c0-.5932.1018-1.1699.2818-1.7114V4.9564H.9573A8.9985 8.9985 0 0 0 0 9c0 1.4523.3477 2.8277.9573 4.0436l3.0068-2.3321Z"
    />
    <path
      fill="#EA4335"
      d="M9 3.5782c1.3214 0 2.5077.4541 3.4418 1.3459l2.5813-2.5813C13.4632.8918 11.4273 0 9 0A8.9988 8.9988 0 0 0 .9573 4.9564l3.0068 2.3322C4.6718 5.1609 6.6559 3.5782 9 3.5782Z"
    />
  </svg>
);

const GoogleButton: FC<{ state: string; label: string }> = ({ state, label }) => (
  <form method="post" action="/authorize" class="w-full">
    <HiddenStateFields state={state} action="google" />
    <button
      type="submit"
      class="inline-flex h-11 w-full items-center justify-center gap-3 rounded-md border border-[#dadce0] bg-white px-4 text-[14px] font-medium text-[#3c4043] shadow-sm transition-colors hover:bg-[#f8f9fa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      style="font-family: 'Google Sans', Roboto, Arial, sans-serif;"
    >
      <GoogleMark />
      {label}
    </button>
  </form>
);

const RequestingApp: FC<{ clientName: string; clientId: string }> = ({ clientName, clientId }) => (
  <div class="grid gap-2 rounded-xl border border-border/70 bg-muted/35 p-4">
    <p class="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">OAuth Request</p>
    <MetaRow label="App" value={clientName} />
    <MetaRow label="Client ID" value={clientId} />
  </div>
);

const AuthLayout: FC<
  PropsWithChildren<{
    clientName: string;
    clientId: string;
    title: string;
    subtitle: string;
  }>
> = ({ clientName, clientId, title, subtitle, children }) => (
  <html lang="en" data-auth-mode="otp">
    <head>
      <meta charSet="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Authorize {clientName}</title>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
    </head>
    <body class="min-h-screen bg-background text-foreground antialiased">
      <main class="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
        <div class="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,theme(colors.sky.100),transparent_35%),radial-gradient(circle_at_bottom,theme(colors.orange.100),transparent_30%),linear-gradient(to_bottom_right,theme(colors.slate.50),theme(colors.white),theme(colors.stone.100))]" />
        <div class="absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgba(15,23,42,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.04)_1px,transparent_1px)] bg-[size:36px_36px]" />
        <Card>
          <CardHeader>
            <RequestingApp clientName={clientName} clientId={clientId} />
            <div class="space-y-1 pt-2">
              <CardTitle>{title}</CardTitle>
              <CardDescription>{subtitle}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
      </main>
    </body>
  </html>
);

const LoginView: FC<Extract<PageProps, { step: "login" }>> = ({ state, error }) => (
  <>
    <ErrorBanner error={error} />
    <GoogleButton state={state} label="Sign in with Google" />
    <Divider label="or continue with email" />

    <div class="grid gap-3">
      <div class="grid grid-cols-2 rounded-lg bg-muted p-1 text-sm">
        <button
          type="button"
          data-tab="otp"
          onclick="setAuthMode('otp')"
          class="rounded-md px-3 py-2 font-medium transition"
        >
          Email code
        </button>
        <button
          type="button"
          data-tab="password"
          onclick="setAuthMode('password')"
          class="rounded-md px-3 py-2 font-medium transition hover:text-foreground"
        >
          Password
        </button>
      </div>

      <form method="post" action="/authorize" class="grid gap-4" data-mode="otp">
        <HiddenStateFields state={state} action="send-otp" />
        <FormField id="otp-email" label="Email">
          <Input id="otp-email" name="email" type="email" required placeholder="you@example.com" autocomplete="email" />
        </FormField>
        <div class="grid gap-2 sm:grid-cols-2">
          <Button type="button" variant="outline" onclick="window.close()">
            Cancel
          </Button>
          <Button type="submit">Send code</Button>
        </div>
      </form>

      <form method="post" action="/authorize" class="grid gap-4" data-mode="password">
        <HiddenStateFields state={state} action="password" />
        <FormField id="pw-email" label="Email">
          <Input id="pw-email" name="email" type="email" required placeholder="you@example.com" autocomplete="email" />
        </FormField>
        <FormField id="pw-password" label="Password">
          <Input
            id="pw-password"
            name="password"
            type="password"
            required
            placeholder="Enter your password"
            autocomplete="current-password"
          />
        </FormField>
        <Button type="button" variant="ghost" onclick="setAuthMode('otp')">
          Use a code instead
        </Button>
        <Button type="submit">Sign in</Button>
      </form>
    </div>

    <form method="post" action="/authorize">
      <HiddenStateFields state={state} action="show-signup" />
      <p class="text-center text-sm text-muted-foreground">
        Don&apos;t have an account?{" "}
        <button type="submit" class="font-medium text-foreground underline underline-offset-4">
          Sign up
        </button>
      </p>
    </form>

    <script dangerouslySetInnerHTML={{ __html: tabScript }} />
  </>
);

const SignupView: FC<Extract<PageProps, { step: "signup" }>> = ({ state, error }) => (
  <>
    <ErrorBanner error={error} />
    <GoogleButton state={state} label="Sign up with Google" />
    <Divider label="or create an account with email" />

    <form method="post" action="/authorize" class="grid gap-4">
      <HiddenStateFields state={state} action="send-otp-signup" />
      <FormField id="su-name" label="Display name">
        <Input id="su-name" name="name" required placeholder="Your name" autocomplete="name" />
      </FormField>
      <FormField id="su-email" label="Email">
        <Input id="su-email" name="email" type="email" required placeholder="you@example.com" autocomplete="email" />
      </FormField>
      <Button type="submit">Create account</Button>
    </form>

    <form method="post" action="/authorize">
      <HiddenStateFields state={state} action="show-login" />
      <p class="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <button type="submit" class="font-medium text-foreground underline underline-offset-4">
          Sign in
        </button>
      </p>
    </form>
  </>
);

const OtpView: FC<Extract<PageProps, { step: "otp" }>> = ({ state, email, name, error }) => (
  <>
    <ErrorBanner error={error} />
    <div class="rounded-xl border border-border/70 bg-muted/35 p-4 text-sm text-muted-foreground">
      A 6-digit verification code was sent to <span class="font-medium text-foreground">{email}</span>.
    </div>

    <form method="post" action="/authorize" class="grid gap-4">
      <HiddenStateFields state={state} action="verify-otp" />
      <input type="hidden" name="email" value={email} />
      {name ? <input type="hidden" name="name" value={name} /> : null}
      <FormField id="otp" label="Verification code">
        <Input
          id="otp"
          name="otp"
          required
          placeholder="123456"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autocomplete="one-time-code"
        />
      </FormField>
      <div class="grid gap-2 sm:grid-cols-2">
        <Button type="button" variant="outline" onclick="window.history.back()">
          Back
        </Button>
        <Button type="submit">Verify</Button>
      </div>
    </form>

    <form method="post" action="/authorize">
      <HiddenStateFields state={state} action={name ? "send-otp-signup" : "send-otp"} />
      <input type="hidden" name="email" value={email} />
      {name ? <input type="hidden" name="name" value={name} /> : null}
      <p class="text-center text-sm text-muted-foreground">
        Didn&apos;t get a code?{" "}
        <button type="submit" class="font-medium text-foreground underline underline-offset-4">
          Resend
        </button>
      </p>
    </form>
  </>
);

const ConsentView: FC<Extract<PageProps, { step: "consent" }> & { clientName: string }> = ({
  state,
  user,
  clientName,
}) => (
  <>
    <div class="rounded-xl border border-border/70 bg-muted/35 p-4 text-sm">
      <p class="text-muted-foreground">
        Signed in as <span class="font-medium text-foreground">{user.email}</span>
        {user.role ? <span> ({user.role})</span> : null}
      </p>
    </div>

    <div class="space-y-2 rounded-xl border border-border/70 bg-background/70 p-4">
      <h2 class="font-medium text-foreground">Allow access for {clientName}?</h2>
      <p class="text-sm leading-6 text-muted-foreground">
        This approves the OAuth request and returns you to the requesting client.
      </p>
    </div>

    <form method="post" action="/authorize" class="grid gap-3">
      <HiddenStateFields state={state} action="approve" />
      <Button type="submit">Approve access</Button>
      <Button type="button" variant="outline" onclick="window.close()">
        Deny
      </Button>
    </form>
  </>
);

export function renderPage(props: PageProps) {
  const clientName = props.clientInfo?.clientName || "MCP Client";
  const clientId = props.clientInfo?.clientId ?? "unknown";
  const title =
    props.step === "signup"
      ? "Create account"
      : props.step === "otp"
        ? "Check your inbox"
        : props.step === "consent"
          ? "Review access"
          : "Welcome back";
  const subtitle =
    props.step === "signup"
      ? "Enter your details to continue."
      : props.step === "otp"
        ? "Enter the code we sent to finish signing in."
        : props.step === "consent"
          ? "Confirm the request before returning to the client."
          : "Sign in with email or Google.";

  return (
    <AuthLayout clientName={clientName} clientId={clientId} title={title} subtitle={subtitle}>
      {props.step === "login" ? <LoginView {...props} /> : null}
      {props.step === "signup" ? <SignupView {...props} /> : null}
      {props.step === "otp" ? <OtpView {...props} /> : null}
      {props.step === "consent" ? <ConsentView {...props} clientName={clientName} /> : null}
    </AuthLayout>
  );
}

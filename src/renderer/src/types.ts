export interface StepResult {
  ok: boolean;
  message?: string;
  version?: string;
  path?: string;
  registry?: string;
  error?: string;
}

export interface DetectionReport {
  env: StepResult;
  node: StepResult;
  npm: StepResult;
  openclaw: StepResult;
  daemon: StepResult;
  config: StepResult;
  ollama: StepResult;
  canEnterGuide: boolean;
  firstFailingStep: string | null;
}

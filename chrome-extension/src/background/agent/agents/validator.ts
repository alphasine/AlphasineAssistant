import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import { z } from 'zod';
import { ActionResult, type AgentOutput } from '../types';
import { Actors, ExecutionState } from '../event/types';
import { HumanMessage, BaseMessage } from '@langchain/core/messages'; // Added BaseMessage
import { generalSettingsStore, ProviderTypeEnum } from '@extension/storage'; // Added
import {
  ChatModelAuthError,
  ChatModelForbiddenError,
  isAbortedError,
  isAuthenticationError,
  isForbiddenError,
  LLM_FORBIDDEN_ERROR_MESSAGE,
  RequestCancelledError,
} from './errors';
const logger = createLogger('ValidatorAgent');

// Define Zod schema for validator output
export const validatorOutputSchema = z.object({
  is_valid: z.union([
    z.boolean(),
    z.string().transform(val => {
      if (val.toLowerCase() === 'true') return true;
      if (val.toLowerCase() === 'false') return false;
      throw new Error('Invalid boolean string');
    }),
  ]), // indicates if the output is correct
  reason: z.string(), // explains why it is valid or not
  answer: z.string(), // the final answer to the task if it is valid
});

export type ValidatorOutput = z.infer<typeof validatorOutputSchema>;

export class ValidatorAgent extends BaseAgent<typeof validatorOutputSchema, ValidatorOutput> {
  private plan: string | null = null; // Current plan to validate against
  private isAdvancedGeminiMode = false;

  constructor(options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    super(validatorOutputSchema, options, { ...extraOptions, id: 'validator' });
    // isAdvancedGeminiMode will be initialized if needed
  }

  private async initializeAdvancedModeCheck() {
    const settings = await generalSettingsStore.getSettings();
    // Assuming llmProviderType is available on this.context, set by Executor
    const providerType = this.context.llmProviderType;
    this.isAdvancedGeminiMode = settings.isAdvancedModeEnabled && providerType === ProviderTypeEnum.Gemini;
    logger.info(`Validator Advanced Gemini Mode: ${this.isAdvancedGeminiMode}`);
  }

  /**
   * Set the plan for the validator agent
   * @param plan - The plan to set
   */
  setPlan(plan: string | null): void {
    this.plan = plan;
  }

  /**
   * Executes the validator agent
   * @returns AgentOutput<ValidatorOutput>
   */
  async execute(): Promise<AgentOutput<ValidatorOutput>> {
    await this.initializeAdvancedModeCheck(); // Check mode before execution

    try {
      this.context.emitEvent(Actors.VALIDATOR, ExecutionState.STEP_START, 'Validating...');

      let userMessageContent = await this.prompt.getUserMessageContent(this.context); // Get raw content
      if (this.plan) {
        userMessageContent = `${userMessageContent}\n\nThe current plan is: \n${this.plan}`;
      }

      let systemMessage = this.prompt.getSystemMessage();
      let finalUserMessage: BaseMessage = new HumanMessage(userMessageContent);

      if (this.isAdvancedGeminiMode) {
        // Placeholder: Potentially use a different system prompt or modify messages for Gemini Advanced Mode
        logger.info('Validator using Advanced Mode prompt modifications (placeholder).');
        // Example: systemMessage = new HumanMessage("You are an advanced Gemini validation expert...");
        // Or, adjust how `finalUserMessage` is constructed or its type if Gemini expects specific formatting
        // For multimodal, ensure image parts are correctly included if this.context.screenshot is available
        // and userMessageContent needs to be an array of MessageContentParts
      }

      // Reconstruct finalUserMessage if it needs to be multimodal and vision is enabled
      if (this.context.options.useVision && this.context.screenshot) {
         if (typeof userMessageContent === 'string') { // Ensure it's a string before creating parts
            finalUserMessage = new HumanMessage({
                content: [
                    { type: "text", text: userMessageContent },
                    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${this.context.screenshot}` } },
                ]
            });
         }
      }


      const inputMessages: BaseMessage[] = [systemMessage, finalUserMessage];
      // logger.info('Validator input messages:', JSON.stringify(inputMessages, null, 2));

      const modelOutput = await this.invoke(inputMessages);
      if (!modelOutput) {
        throw new Error('Failed to validate task result');
      }

      logger.info('validator output', JSON.stringify(modelOutput, null, 2));

      if (!modelOutput.is_valid) {
        // need to update the action results so that other agents can see the error
        const msg = `The answer is not yet correct. ${modelOutput.reason}.`;
        this.context.emitEvent(Actors.VALIDATOR, ExecutionState.STEP_FAIL, msg);
        this.context.actionResults = [new ActionResult({ extractedContent: msg, includeInMemory: true })];
      } else {
        this.context.emitEvent(Actors.VALIDATOR, ExecutionState.STEP_OK, modelOutput.answer);
      }

      return {
        id: this.id,
        result: modelOutput,
      };
    } catch (error) {
      // Check if this is an authentication error
      if (isAuthenticationError(error)) {
        throw new ChatModelAuthError('Validator API Authentication failed. Please verify your API key', error);
      }
      if (isForbiddenError(error)) {
        throw new ChatModelForbiddenError(LLM_FORBIDDEN_ERROR_MESSAGE, error);
      }
      if (isAbortedError(error)) {
        throw new RequestCancelledError((error as Error).message);
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Validation failed: ${errorMessage}`);
      this.context.emitEvent(Actors.VALIDATOR, ExecutionState.STEP_FAIL, `Validation failed: ${errorMessage}`);
      return {
        id: this.id,
        error: `Validation failed: ${errorMessage}`,
      };
    }
  }
}

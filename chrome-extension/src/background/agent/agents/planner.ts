import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import { z } from 'zod';
import type { AgentOutput } from '../types';
import { HumanMessage, BaseMessage } from '@langchain/core/messages'; // Added BaseMessage
import { Actors, ExecutionState } from '../event/types';
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
const logger = createLogger('PlannerAgent');

// Define Zod schema for planner output
export const plannerOutputSchema = z.object({
  observation: z.string(),
  challenges: z.string(),
  done: z.union([
    z.boolean(),
    z.string().transform(val => {
      if (val.toLowerCase() === 'true') return true;
      if (val.toLowerCase() === 'false') return false;
      throw new Error('Invalid boolean string');
    }),
  ]),
  next_steps: z.string(),
  reasoning: z.string(),
  web_task: z.union([
    z.boolean(),
    z.string().transform(val => {
      if (val.toLowerCase() === 'true') return true;
      if (val.toLowerCase() === 'false') return false;
      throw new Error('Invalid boolean string');
    }),
  ]),
});

export type PlannerOutput = z.infer<typeof plannerOutputSchema>;

export class PlannerAgent extends BaseAgent<typeof plannerOutputSchema, PlannerOutput> {
  private isAdvancedGeminiMode = false;

  constructor(options: BaseAgentOptions, extraOptions?: Partial<ExtraAgentOptions>) {
    super(plannerOutputSchema, options, { ...extraOptions, id: 'planner' });
    // isAdvancedGeminiMode will be initialized in an async way if needed, or before execute
  }

  private async initializeAdvancedModeCheck() {
    const settings = await generalSettingsStore.getSettings();
    // Assuming llmProviderType is available on this.context, set by Executor
    const providerType = this.context.llmProviderType;
    this.isAdvancedGeminiMode = settings.isAdvancedModeEnabled && providerType === ProviderTypeEnum.Gemini;
    logger.info(`Planner Advanced Gemini Mode: ${this.isAdvancedGeminiMode}`);
  }

  async execute(): Promise<AgentOutput<PlannerOutput>> {
    await this.initializeAdvancedModeCheck(); // Check mode before execution

    try {
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_START, 'Planning...');
      const messages = this.context.messageManager.getMessages();
      let systemMessage = this.prompt.getSystemMessage();
      let plannerMessages: BaseMessage[] = [...messages.slice(1)]; // Use full message history except the first one (original system)

      if (this.isAdvancedGeminiMode) {
        // Placeholder: Potentially use a different system prompt or modify messages for Gemini Advanced Mode
        logger.info('Planner using Advanced Mode prompt modifications (placeholder).');
        // Example: systemMessage = new HumanMessage("You are an advanced Gemini planning assistant...");
        // Or, modify how `plannerMessages` are constructed or formatted.
      }

      plannerMessages = [systemMessage, ...plannerMessages];


      // Remove images from last message if vision is not enabled for planner but vision is enabled
      // This logic might also be adjusted in advanced mode if Gemini handles mixed content differently.
      if (!this.context.options.useVisionForPlanner && this.context.options.useVision && plannerMessages.length > 0) {
        const lastStateMessage = plannerMessages[plannerMessages.length - 1];
        let newMsg = '';

        if (Array.isArray(lastStateMessage.content)) {
          for (const msg of lastStateMessage.content) {
            if (msg.type === 'text') {
              newMsg += msg.text;
            }
            // Skip image_url messages
          }
        } else {
          newMsg = lastStateMessage.content;
        }

        plannerMessages[plannerMessages.length - 1] = new HumanMessage(newMsg);
      }

      const modelOutput = await this.invoke(plannerMessages);
      if (!modelOutput) {
        throw new Error('Failed to validate planner output');
      }
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_OK, modelOutput.next_steps);
      logger.info('Planner output', JSON.stringify(modelOutput, null, 2));

      return {
        id: this.id,
        result: modelOutput,
      };
    } catch (error) {
      // Check if this is an authentication error
      if (isAuthenticationError(error)) {
        throw new ChatModelAuthError('Planner API Authentication failed. Please verify your API key', error);
      }
      if (isForbiddenError(error)) {
        throw new ChatModelForbiddenError(LLM_FORBIDDEN_ERROR_MESSAGE, error);
      }
      if (isAbortedError(error)) {
        throw new RequestCancelledError((error as Error).message);
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Planning failed: ${errorMessage}`);
      this.context.emitEvent(Actors.PLANNER, ExecutionState.STEP_FAIL, `Planning failed: ${errorMessage}`);
      return {
        id: this.id,
        error: errorMessage,
      };
    }
  }
}

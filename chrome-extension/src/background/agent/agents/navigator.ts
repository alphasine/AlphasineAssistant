import { z } from 'zod';
import { BaseAgent, type BaseAgentOptions, type ExtraAgentOptions } from './base';
import { createLogger } from '@src/background/log';
import { ActionResult, type AgentOutput } from '../types';
import type { Action, ActionInput } from '../actions/builder'; // Added ActionInput
import { buildDynamicActionSchema } from '../actions/builder';
import { agentBrainSchema } from '../types';
import { type BaseMessage, HumanMessage, AIMessage } from '@langchain/core/messages'; // Added AIMessage
import { Actors, ExecutionState } from '../event/types';
// Langchain specific imports for Gemini function calling
import { formatToGoogleGenerativeAIFunction } from '@langchain/google-genai';
import { JsonOutputFunctionsParser } from 'langchain/output_parsers/openai_functions';
import { generalSettingsStore, ProviderTypeEnum } from '@extension/storage'; // Added generalSettingsStore & ProviderTypeEnum
import {
  ChatModelAuthError,
  ChatModelForbiddenError,
  isAbortedError,
  isAuthenticationError,
  isForbiddenError,
  LLM_FORBIDDEN_ERROR_MESSAGE,
  RequestCancelledError,
} from './errors';
import { calcBranchPathHashSet } from '@src/background/dom/views';
import { URLNotAllowedError } from '@src/background/browser/views';
import { convertZodToJsonSchema, repairJsonString } from '@src/background/utils';

const logger = createLogger('NavigatorAgent');

export class NavigatorActionRegistry {
  private actions: Record<string, Action> = {};

  constructor(actions: Action[]) {
    for (const action of actions) {
      this.registerAction(action);
    }
  }

  registerAction(action: Action): void {
    this.actions[action.name()] = action;
  }

  unregisterAction(name: string): void {
    delete this.actions[name];
  }

  getAction(name: string): Action | undefined {
    return this.actions[name];
  }

  getActions(): Action[] {
    return Object.values(this.actions);
  }

  setupModelOutputSchema(): z.ZodType {
    const actionSchema = buildDynamicActionSchema(Object.values(this.actions));
    return z.object({
      current_state: agentBrainSchema,
      action: z.array(actionSchema),
    });
  }
}

export interface NavigatorResult {
  done: boolean;
}

// Define the expected output structure for Gemini function calling
// This will be an array of objects, where each object has a function name and its arguments
type GeminiFunctionCallOutput = Array<{
  [key: string]: ActionInput; // Function name maps to its arguments
}>;

export class NavigatorAgent extends BaseAgent<z.ZodType, NavigatorResult> {
  private actionRegistry: NavigatorActionRegistry;
  private jsonSchema: Record<string, unknown>; // For standard structured output
  private isAdvancedGeminiMode = false; // Flag for advanced mode

  constructor(
    actionRegistry: NavigatorActionRegistry,
    options: BaseAgentOptions,
    extraOptions?: Partial<ExtraAgentOptions>,
  ) {
    super(actionRegistry.setupModelOutputSchema(), options, { ...extraOptions, id: 'navigator' });
    this.actionRegistry = actionRegistry;
    this.jsonSchema = convertZodToJsonSchema(this.modelOutputSchema, 'NavigatorAgentOutput', true);
    // We'll set isAdvancedGeminiMode properly in an async init or before execute
  }

  private async initializeAdvancedModeCheck() {
    const settings = await generalSettingsStore.getSettings();
    const providerType = this.context.llmProviderType; // Assuming llmProviderType is available in context
    this.isAdvancedGeminiMode = settings.isAdvancedModeEnabled && providerType === ProviderTypeEnum.Gemini;
    logger.info(`Navigator Advanced Gemini Mode: ${this.isAdvancedGeminiMode}`);
  }

  async invoke(inputMessages: BaseMessage[]): Promise<any> { // Return type changed to any for flexibility
    if (this.isAdvancedGeminiMode) {
      // Logic for Gemini native function calling
      const functions = this.actionRegistry.getActions().map(action =>
        formatToGoogleGenerativeAIFunction({
          name: action.name(),
          description: action.description(),
          parameters: action.parametersDefinition() as z.ZodObject<any, any, any>, // Cast needed
        }),
      );

      const llmWithFunctions = this.chatLLM.bind({ functions });
      const aiMessage = await llmWithFunctions.invoke(inputMessages, { signal: this.context.controller.signal, ...this.callOptions });

      // Parse the tool calls from AIMessage
      // The actual parsing might need adjustment based on how LangChain's Gemini wrapper structures tool_calls
      // For now, assuming it's somewhat similar to OpenAI's or requires a specific parser.
      // This part is CRUCIAL and might need debugging with actual Gemini responses.
      const toolCalls = (aiMessage as AIMessage).additional_kwargs?.tool_calls || (aiMessage as AIMessage).additional_kwargs?.function_call;
      logger.info('Gemini raw tool_calls:', JSON.stringify(toolCalls, null, 2));


      if (toolCalls && Array.isArray(toolCalls)) {
        const parsedActions: GeminiFunctionCallOutput = toolCalls.map((call: any) => {
          // Adjust this based on actual structure of Gemini tool_calls from LangChain
          // This assumes call.function.name and JSON.parse(call.function.arguments)
          const functionName = call.function?.name;
          let functionArgs = {};
          try {
            functionArgs = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
          } catch (e) {
            logger.error(`Error parsing Gemini function arguments for ${functionName}:`, e);
            // Potentially try to repair JSON if that's a common issue
             try {
                const repairedArgs = repairJsonString(call.function.arguments);
                functionArgs = JSON.parse(repairedArgs);
                logger.info(`Successfully parsed repaired arguments for ${functionName}`);
             } catch (repairError) {
                logger.error(`Failed to parse even repaired arguments for ${functionName}:`, repairError);
                // Decide how to handle: skip this action, error out, etc.
             }
          }
          if (functionName) {
            return { [functionName]: functionArgs };
          }
          return null;
        }).filter(action => action !== null) as GeminiFunctionCallOutput;

        logger.info('Parsed Gemini actions:', JSON.stringify(parsedActions, null, 2));
        // We need to wrap this to match the expected structure of doMultiAction if possible,
        // or adapt doMultiAction. For now, let's return the direct parsed actions.
        // The existing `addModelOutputToMemory` expects a specific structure.
        // The `doMultiAction` also expects `response.action`.
        // Let's construct a compatible structure.
        return { current_state: { reasoning: "Function call via Gemini Advanced Mode", text: "" }, action: parsedActions };

      } else if (toolCalls && typeof toolCalls === 'object' && (toolCalls as any).function?.name) { // Single function call case
        const call = toolCalls as any;
        const functionName = call.function.name;
        let functionArgs = {};
        try {
            functionArgs = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch (e) { logger.error(`Error parsing single Gemini function arguments for ${functionName}:`, e); }
         logger.info('Parsed single Gemini action:', JSON.stringify({ [functionName]: functionArgs }, null, 2));
        return { current_state: { reasoning: "Single function call via Gemini Advanced Mode", text: "" }, action: [{ [functionName]: functionArgs }] };
      }

      logger.warn('No tool calls found in Gemini response or format not recognized as array/object.', aiMessage.content);
      // Fallback or handle cases where no function call was made but text content exists
      return { current_state: { reasoning: "No function call made by Gemini.", text: typeof aiMessage.content === 'string' ? aiMessage.content : JSON.stringify(aiMessage.content) }, action: [] };

    } else if (this.withStructuredOutput) {
      // Standard structured output logic (existing code)
      const structuredLlm = this.chatLLM.withStructuredOutput(this.jsonSchema, {
        includeRaw: true,
        name: this.modelOutputToolName,
      });

      let response = undefined;
      try {
        response = await structuredLlm.invoke(inputMessages, {
          signal: this.context.controller.signal,
          ...this.callOptions,
        });

        if (response.parsed) {
          return response.parsed;
        }
      } catch (error) {
        if (isAbortedError(error)) {
          throw error;
        }
        const errorMessage = `Failed to invoke ${this.modelName} with structured output: ${error}`;
        throw new Error(errorMessage);
      }

      const rawResponse = response.raw as BaseMessage & {
        tool_calls?: Array<{
          args: {
            currentState: typeof agentBrainSchema._type;
            action: z.infer<ReturnType<typeof buildDynamicActionSchema>>;
          };
        }>;
      };

      if (rawResponse.tool_calls && rawResponse.tool_calls.length > 0) {
        logger.info('Navigator structuredLlm tool call with empty content', rawResponse.tool_calls);
        const toolCall = rawResponse.tool_calls[0];
        return {
          current_state: toolCall.args.currentState,
          action: [...toolCall.args.action],
        };
      }
      throw new Error('Could not parse response for standard structured output');
    }
    throw new Error('Navigator configuration error: No valid invocation method.');
  }


  async execute(): Promise<AgentOutput<NavigatorResult>> {
    await this.initializeAdvancedModeCheck(); // Check mode before execution

    const agentOutput: AgentOutput<NavigatorResult> = { id: this.id };
    let cancelled = false;

    try {
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_START, 'Navigating...');
      const messageManager = this.context.messageManager;
      await this.addStateMessageToMemory();

      if (this.context.paused || this.context.stopped) {
        cancelled = true;
        return agentOutput;
      }

      const inputMessages = messageManager.getMessages();
      const modelOutput = await this.invoke(inputMessages); // invoke handles advanced mode internally

      if (this.context.paused || this.context.stopped) {
        cancelled = true;
        return agentOutput;
      }

      this.removeLastStateMessageFromMemory();
      // Ensure modelOutput is added in a consistent format for addModelOutputToMemory
      // If Gemini mode returns a different structure, it needs to be adapted here or in invoke.
      // The current `invoke` for Gemini mode tries to return a compatible structure.
      this.addModelOutputToMemory(modelOutput);


      const actionResults = await this.doMultiAction(modelOutput);
      this.context.actionResults = actionResults;

      if (this.context.paused || this.context.stopped) {
      if (this.context.paused || this.context.stopped) {
        cancelled = true;
        return agentOutput;
      }
      // emit event
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_OK, 'Navigation done');
      let done = false;
      if (actionResults.length > 0 && actionResults[actionResults.length - 1].isDone) {
        done = true;
      }
      agentOutput.result = { done };
      return agentOutput;
    } catch (error) {
      this.removeLastStateMessageFromMemory();
      // Check if this is an authentication error
      if (isAuthenticationError(error)) {
        throw new ChatModelAuthError('Navigator API Authentication failed. Please verify your API key', error);
      }
      if (isForbiddenError(error)) {
        throw new ChatModelForbiddenError(LLM_FORBIDDEN_ERROR_MESSAGE, error);
      }
      if (isAbortedError(error)) {
        throw new RequestCancelledError((error as Error).message);
      }
      if (error instanceof URLNotAllowedError) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorString = `Navigation failed: ${errorMessage}`;
      logger.error(errorString);
      this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_FAIL, errorString);
      agentOutput.error = errorMessage;
      return agentOutput;
    } finally {
      // if the task is cancelled, remove the last state message from memory and emit event
      if (cancelled) {
        this.removeLastStateMessageFromMemory();
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.STEP_CANCEL, 'Navigation cancelled');
      }
    }
  }

  /**
   * Add the state message to the memory
   */
  public async addStateMessageToMemory() {
    if (this.context.stateMessageAdded) {
      return;
    }

    const messageManager = this.context.messageManager;
    // Handle results that should be included in memory
    if (this.context.actionResults.length > 0) {
      let index = 0;
      for (const r of this.context.actionResults) {
        if (r.includeInMemory) {
          if (r.extractedContent) {
            const msg = new HumanMessage(`Action result: ${r.extractedContent}`);
            // logger.info('Adding action result to memory', msg.content);
            messageManager.addMessageWithTokens(msg);
          }
          if (r.error) {
            // Get error text and convert to string
            const errorText = r.error.toString().trim();

            // Get only the last line of the error
            const lastLine = errorText.split('\n').pop() || '';

            const msg = new HumanMessage(`Action error: ${lastLine}`);
            logger.info('Adding action error to memory', msg.content);
            messageManager.addMessageWithTokens(msg);
          }
          // reset this action result to empty, we dont want to add it again in the state message
          // NOTE: in python version, all action results are reset to empty, but in ts version, only those included in memory are reset to empty
          this.context.actionResults[index] = new ActionResult();
        }
        index++;
      }
    }

    const state = await this.prompt.getUserMessage(this.context);
    messageManager.addStateMessage(state);
    this.context.stateMessageAdded = true;
  }

  /**
   * Remove the last state message from the memory
   */
  protected async removeLastStateMessageFromMemory() {
    if (!this.context.stateMessageAdded) return;
    const messageManager = this.context.messageManager;
    messageManager.removeLastStateMessage();
    this.context.stateMessageAdded = false;
  }

  private async addModelOutputToMemory(modelOutput: this['ModelOutput']) {
    const messageManager = this.context.messageManager;
    messageManager.addModelOutput(modelOutput);
  }

  private async doMultiAction(response: this['ModelOutput']): Promise<ActionResult[]> {
    const results: ActionResult[] = [];
    let errCount = 0;

    logger.info('Actions', response.action);
    // sometimes response.action is a string, but not an array as expected, so we need to parse it as an array
    let actions: Record<string, unknown>[] = [];
    if (Array.isArray(response.action)) {
      // if the item is null, skip it
      actions = response.action.filter((item: unknown) => item !== null);
      if (actions.length === 0) {
        logger.warning('No valid actions found', response.action);
      }
    } else if (typeof response.action === 'string') {
      try {
        logger.warning('Unexpected action format', response.action);
        // First try to parse the action string directly
        actions = JSON.parse(response.action);
      } catch (parseError) {
        try {
          // If direct parsing fails, try to fix the JSON first
          const fixedAction = repairJsonString(response.action);
          logger.info('Fixed action string', fixedAction);
          actions = JSON.parse(fixedAction);
        } catch (error) {
          logger.error('Invalid action format even after repair attempt', response.action);
          throw new Error('Invalid action output format');
        }
      }
    } else {
      // if the action is neither an array nor a string, it should be an object
      actions = [response.action];
    }

    const browserContext = this.context.browserContext;
    const browserState = await browserContext.getState(this.context.options.useVision);
    const cachedPathHashes = await calcBranchPathHashSet(browserState);

    await browserContext.removeHighlight();

    for (const [i, action] of actions.entries()) {
      const actionName = Object.keys(action)[0];
      const actionArgs = action[actionName];
      try {
        // check if the task is paused or stopped
        if (this.context.paused || this.context.stopped) {
          return results;
        }

        const actionInstance = this.actionRegistry.getAction(actionName);
        if (actionInstance === undefined) {
          throw new Error(`Action ${actionName} not exists`);
        }

        const indexArg = actionInstance.getIndexArg(actionArgs);
        if (i > 0 && indexArg !== null) {
          const newState = await browserContext.getState(this.context.options.useVision);
          const newPathHashes = await calcBranchPathHashSet(newState);
          // next action requires index but there are new elements on the page
          if (!newPathHashes.isSubsetOf(cachedPathHashes)) {
            const msg = `Something new appeared after action ${i} / ${actions.length}`;
            logger.info(msg);
            results.push(
              new ActionResult({
                extractedContent: msg,
                includeInMemory: true,
              }),
            );
            break;
          }
        }

        const result = await actionInstance.call(actionArgs);
        if (result === undefined) {
          throw new Error(`Action ${actionName} returned undefined`);
        }
        results.push(result);
        // check if the task is paused or stopped
        if (this.context.paused || this.context.stopped) {
          return results;
        }
        // TODO: wait for 1 second for now, need to optimize this to avoid unnecessary waiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        if (error instanceof URLNotAllowedError) {
          throw error;
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(
          'doAction error',
          actionName,
          JSON.stringify(actionArgs, null, 2),
          JSON.stringify(errorMessage, null, 2),
        );
        // unexpected error, emit event
        this.context.emitEvent(Actors.NAVIGATOR, ExecutionState.ACT_FAIL, errorMessage);
        errCount++;
        if (errCount > 3) {
          throw new Error('Too many errors in actions');
        }
        results.push(
          new ActionResult({
            error: errorMessage,
            isDone: false,
            includeInMemory: true,
          }),
        );
      }
    }
    return results;
  }
}

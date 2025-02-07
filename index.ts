const { SolanaAgentKit, createSolanaTools } = require("solana-agent-kit");
const { HumanMessage } = require("@langchain/core/messages");
const { MemorySaver } = require("@langchain/langgraph");
const { createReactAgent } = require("@langchain/langgraph/prebuilt");
const { ChatOpenAI } = require("@langchain/openai");
const dotenv = require("dotenv");
const fs = require("fs");
const readline = require("readline");
const { BalanceMonitorTool } = require("./tools/BalanceMonitorTool");
const { Tool } = require("@langchain/core/tools");

dotenv.config();

function validateEnvironment(): void {
  const missingVars: string[] = [];
  const requiredVars = ["OPENAI_API_KEY", "RPC_URL", "SOLANA_PRIVATE_KEY"];

  requiredVars.forEach((varName) => {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  });

  if (missingVars.length > 0) {
    console.error("Error: Required environment variables are not set");
    missingVars.forEach((varName) => {
      console.error(`${varName}=your_${varName.toLowerCase()}_here`);
    });
    process.exit(1);
  }
}

validateEnvironment();

const WALLET_DATA_FILE = "wallet_data.txt";

async function initializeAgent() {
  try {
    const llm = new ChatOpenAI({
      modelName: "deepseek/deepseek-r1-distill-qwen-32b",
      temperature: 0.7,
      configuration: {
        baseURL: "https://api.openputer.com/v1/",
      },
    });

    let walletDataStr: string | null = null;

    if (fs.existsSync(WALLET_DATA_FILE)) {
      try {
        walletDataStr = fs.readFileSync(WALLET_DATA_FILE, "utf8");
      } catch (error) {
        console.error("Error reading wallet data:", error);
      }
    }

    const solanaAgent = new SolanaAgentKit(
      process.env.SOLANA_PRIVATE_KEY!,
      process.env.RPC_URL,
      process.env.OPENAI_API_KEY!,
    );

    const balanceMonitor = new BalanceMonitorTool(
      process.env.RPC_URL!,
      process.env.OPEN_PUTER_WALLET_ADDRESS!,
      solanaAgent
    );

    // Create custom tools from SolanaAgentKit methods
    const tpsChecker = new Tool({
      name: "check_tps",
      description: "Get the current Transactions Per Second (TPS) of the Solana network",
      func: async () => {
        const tps = await solanaAgent.getTPS();
        return `Current Solana network TPS: ${tps}`;
      }
    });

    const tokenPriceChecker = new Tool({
      name: "check_token_price",
      description: "Get the price of SOL token",
      func: async () => {
        try {
          // SOL mint address
          const solMint = "So11111111111111111111111111111111111111112";
          const price = await solanaAgent.fetchTokenPrice(solMint);
          return `SOL price: ${price}`;
        } catch (error) {
          return `Could not fetch SOL price: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    });

    const networkInfo = new Tool({
      name: "network_info",
      description: "Get comprehensive information about the Solana network status",
      func: async () => {
        try {
          const tps = await solanaAgent.getTPS();
          return `Solana Network Status:\n- TPS: ${tps}\n- RPC Endpoint: ${process.env.RPC_URL}`;
        } catch (error) {
          return `Could not fetch network info: ${error instanceof Error ? error.message : String(error)}`;
        }
      }
    });

    const solanaTools = createSolanaTools(solanaAgent);
    const tools = [
      ...solanaTools, 
      balanceMonitor,
      tpsChecker,
      tokenPriceChecker,
      networkInfo
    ];

    const memory = new MemorySaver();
    const config = { configurable: { thread_id: "Solana Agent Kit!" } };

    const agent = createReactAgent({
      llm,
      tools,
      checkpointSaver: memory,
      messageModifier: `
        You are a helpful agent that can interact onchain using the Solana Agent Kit. You have access to
        several tools:

        1. balance_monitor - Checks and maintains wallet balances
        2. network_info - Gets Solana network status
        3. check_token_price - Gets current SOL price
        4. check_tps - Gets network TPS

        When handling requests:
        - For balance queries: Use balance_monitor with "check" input
        - For network status: Use network_info tool
        - For SOL price: Use check_token_price tool
        - For TPS: Use check_tps tool

        When asked to perform autonomous actions, choose ONE of the available tools and execute it directly.
        Return the tool's response without additional commentary.

        If there is a 5XX error, ask the user to try again later.
        Be concise and helpful with your responses.
      `,
    });

    if (walletDataStr) {
      fs.writeFileSync(WALLET_DATA_FILE, walletDataStr);
    }

    return { agent, config, tools };
  } catch (error) {
    console.error("Failed to initialize agent:", error);
    throw error;
  }
}

async function runAutonomousMode(agent: any, config: any, tools: any[], interval = 10) {
  console.log("\n🤖 Initializing Self-Healing AI Agent...");
  console.log("🔄 Running continuous monitoring and maintenance cycle\n");

  while (true) {
    try {
      // Visual separator for each cycle
      console.log("\n" + "=".repeat(50));
      console.log("🔍 DIAGNOSTIC CYCLE STARTING");
      console.log("=".repeat(50));

      // Check balance and handle maintenance
      const balanceMonitor = tools.find((tool: any) => tool.name === "balance_monitor");
      if (balanceMonitor) {
        console.log("\n💰 Checking Wallet Health...");
        const balance = await balanceMonitor._call("check");
        console.log("📊 Status Report:");
        console.log(balance);
      }

      // Network health check with visual indicators
      console.log("\n🌐 Performing Network Analysis...");
      const thought = 
        "Choose and execute ONE of these monitoring tools:\n" +
        "- Network Status Check (network_info)\n" +
        "- Market Analysis (check_token_price)\n" +
        "- Performance Metrics (check_tps)";

      console.log("\n🤔 AI Agent is analyzing situation...");
      const stream = await agent.stream(
        { messages: [new HumanMessage(thought)] },
        config,
      );

      for await (const chunk of stream) {
        if ("agent" in chunk) {
          console.log("\n🔄 Agent Response:");
          console.log(chunk.agent.messages[0].content);
        } else if ("tools" in chunk) {
          console.log("\n🛠️ Tool Execution Result:");
          console.log(chunk.tools.messages[0].content);
        }
      }

      console.log("\n⏳ Next health check in " + interval + " seconds...");
      console.log("=".repeat(50) + "\n");
      
      await new Promise((resolve) => setTimeout(resolve, interval * 1000));
    } catch (error) {
      console.log("\n⚠️ ALERT: System Anomaly Detected!");
      if (error instanceof Error) {
        console.error("🔧 Self-Healing Protocol Initiated:", error.message);
      }
      // Add a shorter retry delay when errors occur
      await new Promise((resolve) => setTimeout(resolve, 5000));
      console.log("🔄 Attempting recovery...\n");
      continue; // Instead of exiting, try to recover
    }
  }
}

async function runChatMode(agent: any, config: any, tools: any[]) {
  console.log("Starting chat mode... Type 'exit' to end.");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  try {
    while (true) {
      const userInput = await question("\nPrompt: ");

      if (userInput.toLowerCase() === "exit") {
        break;
      }

      // For balance queries, directly use the balance monitor tool
      if (userInput.toLowerCase().includes("balance")) {
        const balanceMonitor = tools.find((tool: any) => tool.name === "balance_monitor");
        if (balanceMonitor) {
          const balance = await balanceMonitor._call("check");
          console.log(balance);
          continue;
        }
      }

      // Handle transfer requests
      if (userInput.toLowerCase().includes("transfer")) {
        const balanceMonitor = tools.find((tool: any) => tool.name === "balance_monitor");
        if (balanceMonitor) {
          try {
            // First check balances
            const result = await balanceMonitor._call("check");
            console.log(result);
            
            // If agent has funds, attempt the transfer
            if (!result.includes("Agent wallet balance: 0.0000 SOL")) {
              // Use a small amount for transfer (0.001 SOL) plus fees
              const transferAmount = 0.001;
              console.log(`\nAttempting to transfer ${transferAmount} SOL...`);
              const transferResult = await balanceMonitor._call(`transfer ${transferAmount}`);
              console.log(transferResult);
            } else {
              console.log("\nTransfer not possible: Agent wallet has no funds to transfer.");
            }
          } catch (error) {
            console.error("\nTransfer failed:", error instanceof Error ? error.message : String(error));
          }
          continue;
        }
      }

      const stream = await agent.stream(
        { messages: [new HumanMessage(userInput)] },
        config,
      );

      for await (const chunk of stream) {
        if ("agent" in chunk) {
          console.log(chunk.agent.messages[0].content);
        } else if ("tools" in chunk) {
          console.log(chunk.tools.messages[0].content);
        }
        console.log("-------------------");
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
    }
    process.exit(1);
  } finally {
    rl.close();
  }
}

async function chooseMode(): Promise<"chat" | "auto"> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("\n🤖 OpenPuter AI Agent Control Panel");
  console.log("=".repeat(40));
  console.log("🗣️  1. chat    - Interactive chat mode");
  console.log("🔄  2. auto    - Self-healing autonomous mode");
  console.log("=".repeat(40));

  const question = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  while (true) {
    const choice = (await question("\nChoose a mode (enter number or name): "))
      .toLowerCase()
      .trim();

    rl.close();

    if (choice === "1" || choice === "chat") {
      return "chat";
    } else if (choice === "2" || choice === "auto") {
      return "auto";
    }
    console.log("Invalid choice. Please try again.");
  }
}

async function main() {
  try {
    console.log("Starting Agent...");
    const { agent, config, tools } = await initializeAgent();
    const mode = await chooseMode();

    if (mode === "chat") {
      await runChatMode(agent, config, tools);
    } else {
      await runAutonomousMode(agent, config, tools);
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

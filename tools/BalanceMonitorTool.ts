import { Tool } from "@langchain/core/tools";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { SolanaAgentKit } from "solana-agent-kit";

export class BalanceMonitorTool extends Tool {
  name = "balance_monitor";
  description = "Monitors wallet balances and maintains funds by automatically topping up when low. Usage: Input a wallet address to check its balance, or 'check' to monitor the default wallet.";

  private connection: Connection;
  private solanaAgent: SolanaAgentKit;
  private minBalanceSol: number;
  private topUpAmountSol: number;
  private defaultWallet: PublicKey;

  constructor(
    rpcUrl: string,
    defaultWalletAddress: string,
    solanaAgent: SolanaAgentKit,
    minBalanceSol = 0.1,
    topUpAmountSol = 0.2
  ) {
    super();
    this.connection = new Connection(rpcUrl);
    this.defaultWallet = new PublicKey(defaultWalletAddress);
    this.solanaAgent = solanaAgent;
    this.minBalanceSol = minBalanceSol;
    this.topUpAmountSol = topUpAmountSol;
  }

  async _call(input: string): Promise<string> {
    try {
      // If input is 'check' or empty, use default wallet
      // Otherwise, try to use input as wallet address
      const targetWallet = input && input !== 'check' 
        ? new PublicKey(input)
        : this.defaultWallet;

      const balance = await this.connection.getBalance(targetWallet);
      const balanceInSol = balance / LAMPORTS_PER_SOL;

      if (balanceInSol < this.minBalanceSol) {
        try {
          await this.solanaAgent.transfer(
            targetWallet,
            this.topUpAmountSol
          );
          
          return `Wallet ${targetWallet.toString()} balance was low (${balanceInSol.toFixed(4)} SOL). Successfully topped up with ${this.topUpAmountSol} SOL.`;
        } catch (error) {
          return `Failed to top up wallet ${targetWallet.toString()}. Error: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      return `Wallet ${targetWallet.toString()} balance is ${balanceInSol.toFixed(4)} SOL. No top-up needed.`;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid public key')) {
        return `Error: Invalid wallet address provided. Please provide a valid Solana wallet address.`;
      }
      return `Error checking balance: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
} 
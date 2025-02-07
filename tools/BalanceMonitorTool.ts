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
    minBalanceSol = 0.01,
    topUpAmountSol = 0.01
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
      // Handle transfer command
      if (input.startsWith('transfer ')) {
        const amount = parseFloat(input.split(' ')[1]);
        if (isNaN(amount)) {
          return 'Invalid transfer amount specified.';
        }
        
        // Perform the transfer
        const signature = await this.solanaAgent.transfer(
          this.defaultWallet,
          amount
        );

        // Wait for confirmation
        await this.connection.confirmTransaction(signature, 'confirmed');
        
        // Check new balances
        const targetBalance = await this.connection.getBalance(this.defaultWallet);
        const targetBalanceInSol = targetBalance / LAMPORTS_PER_SOL;
        const agentWallet = this.solanaAgent.wallet.publicKey;
        const agentBalance = await this.connection.getBalance(agentWallet);
        const agentBalanceInSol = agentBalance / LAMPORTS_PER_SOL;
        
        return `Transfer successful! ✅\nNew monitored wallet balance: ${targetBalanceInSol.toFixed(4)} SOL\nNew agent wallet balance: ${agentBalanceInSol.toFixed(4)} SOL`;
      }

      // If input is 'check' or empty, use default wallet
      // Otherwise, try to use input as wallet address
      const targetWallet = input && input !== 'check' 
        ? new PublicKey(input)
        : this.defaultWallet;

      const balance = await this.connection.getBalance(targetWallet);
      const balanceInSol = balance / LAMPORTS_PER_SOL;

      // Format a clear balance message first
      let balanceMessage = targetWallet.equals(this.defaultWallet)
        ? `Monitored wallet balance: ${balanceInSol.toFixed(4)} SOL (${targetWallet.toString()})`
        : `Wallet balance for ${targetWallet.toString()}: ${balanceInSol.toFixed(4)} SOL`;

      // Also show agent's wallet balance for context
      const agentWallet = this.solanaAgent.wallet.publicKey;
      const agentBalance = await this.connection.getBalance(agentWallet);
      const agentBalanceInSol = agentBalance / LAMPORTS_PER_SOL;
      balanceMessage += `\nAgent wallet balance: ${agentBalanceInSol.toFixed(4)} SOL (${agentWallet.toString()})`;

      if (balanceInSol < this.minBalanceSol) {
        try {
          // Check source wallet balance first
          const sourceWallet = this.solanaAgent.wallet.publicKey;
          const sourceBalance = await this.connection.getBalance(sourceWallet);
          const sourceBalanceInSol = sourceBalance / LAMPORTS_PER_SOL;
          
          // Account for transaction fees (0.000005 SOL)
          const requiredAmount = this.topUpAmountSol + 0.000005;

          if (sourceBalanceInSol < requiredAmount) {
            return `${balanceMessage}\n\nI need some SOL to keep operating! 🙏\nPlease send at least ${requiredAmount.toFixed(6)} SOL to my address:\n${sourceWallet.toString()}\n\nThis amount includes transaction fees. Once you've sent the SOL, let me know by saying "check balance" and I'll verify the funds and proceed with the top-up.`;
          }

          balanceMessage += `\nMy wallet balance: ${sourceBalanceInSol.toFixed(4)} SOL`;

          // Perform the transfer and wait for confirmation
          const signature = await this.solanaAgent.transfer(
            targetWallet,
            this.topUpAmountSol
          );

          // Wait for confirmation
          await this.connection.confirmTransaction(signature, 'confirmed');
          
          // Check new balance
          const newBalance = await this.connection.getBalance(targetWallet);
          const newBalanceInSol = newBalance / LAMPORTS_PER_SOL;
          
          return `${balanceMessage}\nTransfer successful! ✅\nNew balance: ${newBalanceInSol.toFixed(4)} SOL`;
        } catch (error) {
          if (error instanceof Error) {
            const errorMsg = error.message.toLowerCase();
            if (errorMsg.includes('insufficient lamports') || errorMsg.includes('0x1')) {
              return `${balanceMessage}\n\nOops! I don't have quite enough SOL for the transfer and fees. Please send a bit more SOL (${this.topUpAmountSol + 0.000005} SOL total) to cover the transaction fees.`;
            }
            if (errorMsg.includes('attempt to debit')) {
              return `${balanceMessage}\n\nHmm, it seems the funds haven't arrived yet. Are you sure you sent the SOL? Please verify and let me know by saying "check balance" again.`;
            }
            return `${balanceMessage}\nTransfer failed: ${error.message}. Please try again in a moment.`;
          }
          return `${balanceMessage}\nTransfer failed. Please try again in a moment.`;
        }
      }

      return balanceMessage;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid public key')) {
        return `Error: Invalid wallet address provided. Please provide a valid Solana wallet address.`;
      }
      return `Error checking balance: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
} 
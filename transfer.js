const { ethers } = require("ethers");
const dotenv = require("dotenv");

dotenv.config();

const RPC_URL = process.env.SEPOLIA_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.VOTE_TOKEN_ADDRESS;

if (!RPC_URL || !PRIVATE_KEY || !CONTRACT_ADDRESS) {
  throw new Error("Missing env: RPC_URL, PRIVATE_KEY, VOTE_TOKEN_ADDRESS");
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// Minimal ABI for what we need
const abi = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

async function transferTokens(toAddress, amount) {
  try {
    const token = new ethers.Contract(CONTRACT_ADDRESS, abi, wallet);
    
    // Get token info
    const decimals = await token.decimals();
    const symbol = await token.symbol();
    
    // Check sender balance
    const senderBalance = await token.balanceOf(wallet.address);
    const transferAmount = ethers.parseUnits(amount.toString(), decimals);
    
    console.log(`Token: ${symbol}`);
    console.log(`From: ${wallet.address}`);
    console.log(`To: ${toAddress}`);
    console.log(`Amount: ${amount} ${symbol}`);
    console.log(`Sender balance: ${ethers.formatUnits(senderBalance, decimals)} ${symbol}`);
    
    if (senderBalance < transferAmount) {
      throw new Error(`Insufficient balance. Need ${amount} ${symbol}, but only have ${ethers.formatUnits(senderBalance, decimals)} ${symbol}`);
    }
    
    // Send transfer transaction
    console.log("Sending transfer transaction...");
    const tx = await token.transfer(toAddress, transferAmount);
    console.log("Transfer tx sent:", tx.hash);
    console.log("Waiting for confirmation...");
    
    const receipt = await tx.wait();
    console.log("Transfer confirmed in block:", receipt.blockNumber);
    console.log("Gas used:", receipt.gasUsed.toString());
    
    // Check balances after transfer
    const newSenderBalance = await token.balanceOf(wallet.address);
    const receiverBalance = await token.balanceOf(toAddress);
    
    console.log("\n=== Transfer Completed ===");
    console.log(`Sender new balance: ${ethers.formatUnits(newSenderBalance, decimals)} ${symbol}`);
    console.log(`Receiver balance: ${ethers.formatUnits(receiverBalance, decimals)} ${symbol}`);
    
    return {
      success: true,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString()
    };
    
  } catch (error) {
    console.error("Transfer failed:", error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

async function main() {
  // 示例转账 - 你可以修改这些参数
  const toAddress = "0x7F72dDF0e619F9B1600D9B68979BD5a3F21C01E7"; // 接收地址
  const amount = "10"; // 转账数量
  
  // 也可以从命令行参数获取
  const args = process.argv.slice(2);
  if (args.length >= 2) {
    const cmdToAddress = args[0];
    const cmdAmount = args[1];
    await transferTokens(cmdToAddress, cmdAmount);
  } else {
    await transferTokens(toAddress, amount);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
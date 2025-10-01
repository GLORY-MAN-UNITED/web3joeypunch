const { ethers } = require("ethers");
const dotenv = require("dotenv");

dotenv.config();

const RPC_URL = process.env.SEPOLIA_RPC_URL;
const SERVER_PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.VOTE_TOKEN_ADDRESS;

if (!RPC_URL || !SERVER_PRIVATE_KEY || !CONTRACT_ADDRESS) {
    throw new Error("Missing environment variables: SEPOLIA_RPC_URL, PRIVATE_KEY, VOTE_TOKEN_ADDRESS");
}

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(SERVER_PRIVATE_KEY, provider);

// Token contract ABI
const abi = [
    "function transfer(address to, uint256 amount) returns (bool)",
    "function balanceOf(address owner) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)"
];

/**
 * 服务器转账奖励token给获胜答案用户
 * @param {string} recipientAddress - 接收者钱包地址
 * @param {number} amount - 转账金额（token数量）
 * @returns {Object} 转账结果
 */
async function transferRewardToWinner(recipientAddress, amount) {
    try {
        const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, wallet);
        
        // 获取token信息
        const decimals = await contract.decimals();
        const symbol = await contract.symbol();
        
        // 检查服务器余额
        const serverBalance = await contract.balanceOf(wallet.address);
        const transferAmount = ethers.parseUnits(amount.toString(), decimals);
        
        console.log(`=== Server Reward Transfer ===`);
        console.log(`Token: ${symbol}`);
        console.log(`From Server: ${wallet.address}`);
        console.log(`To Winner: ${recipientAddress}`);
        console.log(`Amount: ${amount} ${symbol}`);
        console.log(`Server Balance: ${ethers.formatUnits(serverBalance, decimals)} ${symbol}`);
        
        if (serverBalance < transferAmount) {
            throw new Error(
                `Insufficient server balance. Need ${amount} ${symbol}, but only have ${ethers.formatUnits(serverBalance, decimals)} ${symbol}`
            );
        }
        
        // 执行转账
        console.log("Sending reward transfer...");
        const tx = await contract.transfer(recipientAddress, transferAmount);
        console.log("Transfer tx sent:", tx.hash);
        console.log("Waiting for confirmation...");
        
        const receipt = await tx.wait();
        console.log("Reward transfer confirmed in block:", receipt.blockNumber);
        console.log("Gas used:", receipt.gasUsed.toString());
        
        // 获取转账后余额
        const [newServerBalance, winnerBalance] = await Promise.all([
            contract.balanceOf(wallet.address),
            contract.balanceOf(recipientAddress)
        ]);
        
        console.log("=== Reward Transfer Completed ===");
        console.log(`Server new balance: ${ethers.formatUnits(newServerBalance, decimals)} ${symbol}`);
        console.log(`Winner balance: ${ethers.formatUnits(winnerBalance, decimals)} ${symbol}`);
        
        return {
            success: true,
            txHash: tx.hash,
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed.toString(),
            serverAddress: wallet.address,
            winnerAddress: recipientAddress,
            amount: amount,
            balances: {
                serverAfter: ethers.formatUnits(newServerBalance, decimals),
                winnerAfter: ethers.formatUnits(winnerBalance, decimals)
            }
        };
        
    } catch (error) {
        console.error("Reward transfer failed:", error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

// 批量转账功能已移除 - 我们的系统只有一个获胜者（最高influence point的答案）

/**
 * 获取服务器token余额
 * @returns {number} 服务器token余额
 */
async function getServerTokenBalance() {
    try {
        const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);
        const balance = await contract.balanceOf(wallet.address);
        const decimals = await contract.decimals();
        
        return parseFloat(ethers.formatUnits(balance, decimals));
    } catch (error) {
        console.error("Failed to get server balance:", error.message);
        return 0;
    }
}

module.exports = {
    transferRewardToWinner,
    getServerTokenBalance
};
const { ethers } = require("ethers");
const dotenv = require("dotenv");

// 加载环境变量
dotenv.config();

// 验证环境变量是否齐全
const RPC_URL = process.env.SEPOLIA_RPC_URL;
const CONTRACT_ADDRESS = process.env.VOTE_TOKEN_ADDRESS;
if (!RPC_URL || !CONTRACT_ADDRESS) {
  throw new Error("请在 .env 文件中配置 SEPOLIA_RPC_URL 和 VOTE_TOKEN_ADDRESS");
}

// 连接到区块链节点
const provider = new ethers.JsonRpcProvider(RPC_URL);

// ERC20 合约 ABI（仅包含查询余额所需的方法）
const abi = [
  "function balanceOf(address account) view returns (uint256)", // 查询余额的方法
  "function decimals() view returns (uint8)" // 获取代币小数位的方法
];

// 初始化合约实例
const tokenContract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);

/**
 * 查询指定地址的 Token 余额
 * @param {string} address - 要查询的钱包地址（从数据库获取）
 * @returns {Promise<number>} - 格式化后的余额（带小数位）
 */
async function getTokenBalance(address) {
  // 新增：验证地址格式（增强健壮性）
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    console.error("无效的钱包地址:", address);
    return 0;
  }

  try {
    // 1. 获取代币的小数位（ERC20 代币通常为 18 位）
    const decimals = await tokenContract.decimals();
    
    // 2. 调用合约的 balanceOf 方法查询余额（返回的是最小单位，如 wei）
    const balanceInWei = await tokenContract.balanceOf(address);
    
    // 3. 将最小单位转换为可读格式（如 1.5 Token 而非 1500000000000000000 wei）
    const formattedBalance = ethers.formatUnits(balanceInWei, decimals);
    
    return parseFloat(formattedBalance);
  } catch (error) {
    console.error("查询余额失败：", error.message);
    return 0;
  }
}

// 移除固定地址的 main 函数，仅导出查询方法供 server.js 调用
module.exports = { getTokenBalance };
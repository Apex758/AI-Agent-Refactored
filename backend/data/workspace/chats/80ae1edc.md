# Chat Memory: Chat Mar 01 14:33

**Chat ID:** 80ae1edc
**Last Updated:** 2026-03-01 14:33

## Summary
The user asked about the GPU requirements for a Tier 2 node. The assistant specified that it requires 2x NVIDIA RTX 6000 Blackwell GPUs, each with 96 GB GDDR6 memory, sourced from LLM Server Architecture.pdf. It supports a 14B model at 5-bit quantization with 2 replicas per GPU, using ~8.75 GB for the model plus ~20-24 GB for KV cache/overhead per replica.

## Keywords
Tier 2 Node, GPU requirements, NVIDIA RTX 6000 Blackwell, 96 GB GDDR6, 14B model, 5-bit, replicas, KV cache, LLM Server Architecture.pdf

## Key Facts
- Tier 2 Node requires 2x NVIDIA RTX 6000 Blackwell GPUs (96 GB GDDR6 each)
- Supports 14B model at 5-bit quantization with 2 replicas per GPU
- Model size: ~8.75 GB + KV cache/overhead: ~20-24 GB per replica
- Information from LLM Server Architecture.pdf

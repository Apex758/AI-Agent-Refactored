"""
Memory summarizer for condensing conversation history.
"""
from typing import List, Dict, Optional
from datetime import datetime

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class MemorySummarizer:
    """
    Summarizes conversation history to reduce memory usage.
    """
    
    def __init__(self):
        self.summary_threshold = settings.summary_threshold
    
    async def should_summarize(self, message_count: int) -> bool:
        """
        Determine if the conversation should be summarized.
        """
        return message_count >= self.summary_threshold
    
    async def summarize_messages(self, messages: List[Dict]) -> str:
        """
        Summarize a list of messages into a concise summary.
        """
        if not messages:
            return ""
        
        # Extract key information
        user_messages = [m["content"] for m in messages if m.get("role") == "user"]
        assistant_messages = [m["content"] for m in messages if m.get("role") == "assistant"]
        
        # Create summary
        summary_parts = []
        
        if user_messages:
            summary_parts.append(f"User asked {len(user_messages)} questions")
            # Include first and last user message as samples
            if len(user_messages) > 1:
                summary_parts.append(f"First question: {user_messages[0][:100]}...")
                summary_parts.append(f"Last question: {user_messages[-1][:100]}...")
            else:
                summary_parts.append(f"Question: {user_messages[0][:100]}...")
        
        if assistant_messages:
            summary_parts.append(f"Assistant provided {len(assistant_messages)} responses")
        
        return " | ".join(summary_parts)
    
    async def create_summary(
        self, 
        messages: List[Dict], 
        include_key_points: bool = True
    ) -> Dict:
        """
        Create a structured summary of the conversation.
        """
        if not messages:
            return {
                "summary": "",
                "message_count": 0,
                "key_topics": []
            }
        
        # Count messages by role
        role_counts = {}
        for msg in messages:
            role = msg.get("role", "unknown")
            role_counts[role] = role_counts.get(role, 0) + 1
        
        # Extract potential key topics (simple keyword extraction)
        key_topics = []
        if include_key_points:
            all_text = " ".join([m.get("content", "") for m in messages])
            key_topics = self._extract_key_topics(all_text)
        
        # Create summary text
        summary = await self.summarize_messages(messages)
        
        return {
            "summary": summary,
            "message_count": len(messages),
            "role_counts": role_counts,
            "key_topics": key_topics,
            "time_range": {
                "start": messages[0].get("timestamp") if messages else None,
                "end": messages[-1].get("timestamp") if messages else None
            }
        }
    
    def _extract_key_topics(self, text: str, max_topics: int = 5) -> List[str]:
        """
        Extract key topics from text using simple frequency analysis.
        """
        # Simple implementation - in production you'd use NLP
        import re
        
        # Remove common words and extract meaningful terms
        stop_words = {
            "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
            "have", "has", "had", "do", "does", "did", "will", "would", "could",
            "should", "may", "might", "must", "shall", "can", "need", "dare",
            "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
            "into", "through", "during", "before", "after", "above", "below",
            "and", "but", "or", "nor", "so", "yet", "both", "either", "neither",
            "not", "only", "just", "also", "very", "too", "quite", "rather"
        }
        
        # Extract words
        words = re.findall(r'\b[a-zA-Z]{4,}\b', text.lower())
        
        # Count frequencies
        word_freq = {}
        for word in words:
            if word not in stop_words:
                word_freq[word] = word_freq.get(word, 0) + 1
        
        # Get top topics
        sorted_words = sorted(word_freq.items(), key=lambda x: x[1], reverse=True)
        return [word for word, _ in sorted_words[:max_topics]]
    
    async def compress_conversation(
        self, 
        messages: List[Dict],
        keep_recent: int = 5
    ) -> List[Dict]:
        """
        Compress conversation by keeping recent messages and summary.
        """
        if len(messages) <= keep_recent:
            return messages
        
        # Get messages to summarize
        messages_to_summarize = messages[:-keep_recent]
        recent_messages = messages[-keep_recent:]
        
        # Create summary
        summary = await self.summarize_messages(messages_to_summarize)
        
        # Create compressed conversation
        compressed = [
            {
                "role": "system",
                "content": f"Previous conversation summary: {summary}",
                "timestamp": messages_to_summarize[0].get("timestamp"),
                "metadata": {"type": "summary"}
            }
        ]
        
        # Add recent messages
        compressed.extend(recent_messages)
        
        return compressed


class ConversationAnalyzer:
    """
    Analyzes conversation patterns and provides insights.
    """
    
    def __init__(self):
        self.summarizer = MemorySummarizer()
    
    async def analyze(self, messages: List[Dict]) -> Dict:
        """
        Analyze a conversation and provide insights.
        """
        if not messages:
            return {"error": "No messages to analyze"}
        
        # Basic statistics
        total_messages = len(messages)
        user_messages = [m for m in messages if m.get("role") == "user"]
        assistant_messages = [m for m in messages if m.get("role") == "assistant"]
        
        # Calculate average message length
        avg_user_length = sum(len(m.get("content", "")) for m in user_messages) / max(len(user_messages), 1)
        avg_assistant_length = sum(len(m.get("content", "")) for m in assistant_messages) / max(len(assistant_messages), 1)
        
        # Get summary
        summary = await self.summarizer.create_summary(messages)
        
        return {
            "total_messages": total_messages,
            "user_messages": len(user_messages),
            "assistant_messages": len(assistant_messages),
            "avg_user_length": round(avg_user_length, 2),
            "avg_assistant_length": round(avg_assistant_length, 2),
            "summary": summary
        }
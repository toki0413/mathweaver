"""Shared intent-trigger keywords for proof/conjecture/grill detection.

Single source of truth for the keywords that route a student input to a
teaching mode. Kept in a leaf module (no internal imports) so that both the
domain layer (proof, conjecture, agents, orchestrator) and the infrastructure
layer (llm client) can depend on it without coupling the layers together.

Adding or changing a keyword touches this one file only.
"""

# Keywords that mark a student input as a proof attempt.
PROOF_TRIGGER_KEYWORDS = [
    "证明", "求证", "prove", "proof", "我要证", "验证以下",
]

# Keywords that mark a student input as a conjecture.
CONJECTURE_TRIGGER_KEYWORDS = [
    "我猜", "猜想", "所有", "任", "每个", "任何", "一定", "必然", "总是",
    "all", "every", "must", "conjecture",
]

# Keywords that trigger Grill Me mode.
GRILL_TRIGGER_KEYWORDS = [
    "考考我", "grill me", "考考看", "来考考", "审问我", "面试我",
]

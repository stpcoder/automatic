# LLM Adapter Package

This package should expose a normalized interface for:

- planner calls
- extractor calls
- draft-generation calls

And adapt them to:

- legacy chat-completions style endpoints
- partial tool-calling support
- strict JSON text fallback

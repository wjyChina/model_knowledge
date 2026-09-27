"""Print architecture facts from a Hugging Face checkpoint without loading weights."""
import argparse
import json

from transformers import AutoConfig


FIELDS = (
    "model_type", "architectures", "hidden_size", "num_hidden_layers",
    "num_attention_heads", "num_key_value_heads", "head_dim",
    "intermediate_size", "vocab_size", "max_position_embeddings",
    "rope_theta", "rope_scaling", "hidden_act", "rms_norm_eps",
    "num_local_experts", "num_experts_per_tok", "num_experts_per_layer",
    "tie_word_embeddings",
)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("model", help="Hub id or local checkpoint directory")
    parser.add_argument("--revision", default=None)
    args = parser.parse_args()
    config = AutoConfig.from_pretrained(args.model, revision=args.revision)
    data = config.to_dict()
    print("=== architecture fields ===")
    for field in FIELDS:
        if field in data and data[field] is not None:
            print(f"{field}: {json.dumps(data[field], ensure_ascii=False)}")
    print("\n=== config class ===")
    print(type(config).__name__)
    print("\n=== all non-null keys (for model-specific fields) ===")
    print(" ".join(sorted(key for key, value in data.items() if value is not None)))


if __name__ == "__main__":
    main()


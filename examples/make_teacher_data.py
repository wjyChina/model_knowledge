"""Generate offline teacher responses for a separately evaluated student."""
import argparse
import json
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--teacher", default="Qwen/Qwen3-1.7B")
    parser.add_argument("--prompts", default="examples/prompts.jsonl")
    parser.add_argument("--output", default="runs/teacher_answers.jsonl")
    parser.add_argument("--max-new-tokens", type=int, default=128)
    args = parser.parse_args()
    if not torch.cuda.is_available():
        raise SystemExit("The example expects a CUDA GPU; adapt device/dtype for CPU")

    tokenizer = AutoTokenizer.from_pretrained(args.teacher)
    model = AutoModelForCausalLM.from_pretrained(
        args.teacher, dtype="auto", device_map="auto"
    ).eval()
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with open(args.prompts, encoding="utf-8") as source, open(args.output, "w", encoding="utf-8") as target:
        for line in source:
            if not line.strip():
                continue
            prompt = json.loads(line)["prompt"]
            messages = [{"role": "user", "content": prompt}]
            inputs = tokenizer.apply_chat_template(
                messages, tokenize=True, add_generation_prompt=True,
                enable_thinking=False, return_tensors="pt",
            ).to(model.device)
            with torch.inference_mode():
                tokens = model.generate(
                    inputs, max_new_tokens=args.max_new_tokens,
                    do_sample=False, pad_token_id=tokenizer.eos_token_id,
                )
            answer = tokenizer.decode(tokens[0, inputs.shape[-1]:], skip_special_tokens=True).strip()
            if not answer:
                continue
            row = {"messages": messages + [{"role": "assistant", "content": answer}]}
            target.write(json.dumps(row, ensure_ascii=False) + "\n")
            written += 1
    print(f"Wrote {written} teacher responses to {args.output}; inspect before training")


if __name__ == "__main__":
    main()

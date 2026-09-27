"""Minimal single-GPU QLoRA SFT on chat JSONL; Linux/WSL2 CUDA example."""
import argparse
import json
from pathlib import Path

import torch
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from torch.utils.data import Dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    Trainer,
    TrainingArguments,
)


class ChatDataset(Dataset):
    def __init__(self, path, tokenizer, max_length):
        self.rows = []
        with open(path, encoding="utf-8") as stream:
            for line_number, line in enumerate(stream, 1):
                if not line.strip():
                    continue
                messages = json.loads(line)["messages"]
                if len(messages) < 2 or messages[-1]["role"] != "assistant":
                    raise ValueError(f"Line {line_number}: last message must be assistant")
                prompt = tokenizer.apply_chat_template(
                    messages[:-1], tokenize=False, add_generation_prompt=True
                )
                prefix = tokenizer.encode(prompt, add_special_tokens=False)
                answer = tokenizer.encode(
                    messages[-1]["content"] + tokenizer.eos_token,
                    add_special_tokens=False,
                )
                ids = (prefix + answer)[:max_length]
                labels = ([-100] * len(prefix) + answer)[:max_length]
                if any(label != -100 for label in labels):
                    self.rows.append({"input_ids": ids, "labels": labels})
        if not self.rows:
            raise ValueError("No trainable responses remain; raise --max-length")

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, index):
        return self.rows[index]


def collate(rows, pad_id):
    width = max(len(row["input_ids"]) for row in rows)
    inputs, labels, masks = [], [], []
    for row in rows:
        n = width - len(row["input_ids"])
        inputs.append(row["input_ids"] + [pad_id] * n)
        labels.append(row["labels"] + [-100] * n)
        masks.append([1] * len(row["input_ids"]) + [0] * n)
    return {"input_ids": torch.tensor(inputs), "labels": torch.tensor(labels),
            "attention_mask": torch.tensor(masks)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="Qwen/Qwen3-0.6B")
    parser.add_argument("--data", default="examples/tickets.jsonl")
    parser.add_argument("--output", default="runs/ticket-lora")
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--steps", type=int, default=20)
    args = parser.parse_args()
    if not torch.cuda.is_available():
        raise SystemExit("This QLoRA example needs a supported NVIDIA CUDA GPU")
    if not Path(args.data).is_file():
        raise SystemExit(f"Missing data: {args.data}")

    bf16 = torch.cuda.is_bf16_supported()
    dtype = torch.bfloat16 if bf16 else torch.float16
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    quant = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
        bnb_4bit_compute_dtype=dtype,
    )
    model = AutoModelForCausalLM.from_pretrained(
        args.model, quantization_config=quant, dtype=dtype, device_map={"": 0}
    )
    model.config.use_cache = False
    model = prepare_model_for_kbit_training(model)
    model = get_peft_model(model, LoraConfig(
        r=8, lora_alpha=16, lora_dropout=0.05, bias="none",
        task_type="CAUSAL_LM", target_modules="all-linear",
    ))
    model.print_trainable_parameters()
    dataset = ChatDataset(args.data, tokenizer, args.max_length)
    training = TrainingArguments(
        output_dir=args.output, per_device_train_batch_size=1,
        gradient_accumulation_steps=4, max_steps=args.steps,
        learning_rate=2e-4, warmup_ratio=0.1,
        bf16=bf16, fp16=not bf16, gradient_checkpointing=True,
        optim="paged_adamw_8bit", logging_steps=1,
        save_strategy="no", report_to="none", remove_unused_columns=False,
    )
    trainer = Trainer(
        model=model, args=training, train_dataset=dataset,
        data_collator=lambda rows: collate(rows, tokenizer.pad_token_id),
    )
    trainer.train()
    model.save_pretrained(args.output)
    tokenizer.save_pretrained(args.output)
    print(f"Saved adapter to {args.output}; evaluate on held-out data before use")


if __name__ == "__main__":
    main()

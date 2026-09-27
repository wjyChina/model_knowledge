"""Single-GPU baseline or replicated multi-GPU LoRA SFT with torchrun."""
import argparse

import torch
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments

from finetune_qlora import ChatDataset, collate


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="Qwen/Qwen3-0.6B")
    parser.add_argument("--data", default="examples/tickets.jsonl")
    parser.add_argument("--output", default="runs/ticket-ddp-lora")
    parser.add_argument("--steps", type=int, default=20)
    args = parser.parse_args()
    if not torch.cuda.is_available():
        raise SystemExit("This example needs a CUDA GPU")
    bf16 = torch.cuda.is_bf16_supported()
    dtype = torch.bfloat16 if bf16 else torch.float16
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    # No device_map: Trainer/Accelerate places one complete replica on each rank.
    model = AutoModelForCausalLM.from_pretrained(args.model, dtype=dtype)
    model.config.use_cache = False
    model = get_peft_model(model, LoraConfig(
        r=8, lora_alpha=16, lora_dropout=0.05, bias="none",
        task_type="CAUSAL_LM", target_modules="all-linear",
    ))
    dataset = ChatDataset(args.data, tokenizer, max_length=512)
    training = TrainingArguments(
        output_dir=args.output, per_device_train_batch_size=1,
        gradient_accumulation_steps=4, max_steps=args.steps,
        learning_rate=2e-4, bf16=bf16, fp16=not bf16,
        gradient_checkpointing=True, ddp_find_unused_parameters=False,
        save_strategy="no", logging_steps=1, report_to="none",
        remove_unused_columns=False,
    )
    trainer = Trainer(
        model=model, args=training, train_dataset=dataset,
        data_collator=lambda rows: collate(rows, tokenizer.pad_token_id),
    )
    trainer.train()
    if trainer.is_world_process_zero():
        trainer.save_model(args.output)
        tokenizer.save_pretrained(args.output)


if __name__ == "__main__":
    main()

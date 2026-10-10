export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_usage: {
        Row: {
          count: number
          period_kind: string
          period_start: string
          updated_at: string
          user_id: string
        }
        Insert: {
          count?: number
          period_kind: string
          period_start: string
          updated_at?: string
          user_id: string
        }
        Update: {
          count?: number
          period_kind?: string
          period_start?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          value?: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      coach_athlete_links: {
        Row: {
          athlete_id: string
          coach_id: string
          disconnected_at: string | null
          id: string
          linked_at: string
          status: string | null
        }
        Insert: {
          athlete_id: string
          coach_id: string
          disconnected_at?: string | null
          id?: string
          linked_at?: string
          status?: string | null
        }
        Update: {
          athlete_id?: string
          coach_id?: string
          disconnected_at?: string | null
          id?: string
          linked_at?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coach_athlete_links_athlete_id_fkey"
            columns: ["athlete_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_athlete_links_coach_id_fkey"
            columns: ["coach_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_dishes: {
        Row: {
          calories: number | null
          carbs: number | null
          created_at: string
          fat: number | null
          fiber: number | null
          id: string
          ingredients: string | null
          items: Json | null
          kind: string
          name: string
          notes: string | null
          protein: number | null
          use_count: number
          user_id: string
        }
        Insert: {
          calories?: number | null
          carbs?: number | null
          created_at?: string
          fat?: number | null
          fiber?: number | null
          id?: string
          ingredients?: string | null
          items?: Json | null
          kind?: string
          name: string
          notes?: string | null
          protein?: number | null
          use_count?: number
          user_id: string
        }
        Update: {
          calories?: number | null
          carbs?: number | null
          created_at?: string
          fat?: number | null
          fiber?: number | null
          id?: string
          ingredients?: string | null
          items?: Json | null
          kind?: string
          name?: string
          notes?: string | null
          protein?: number | null
          use_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_dishes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      exercises: {
        Row: {
          body_parts: string[] | null
          created_at: string
          equipment: string | null
          id: string
          is_archived: boolean
          is_master: boolean
          name: string
          user_id: string | null
        }
        Insert: {
          body_parts?: string[] | null
          created_at?: string
          equipment?: string | null
          id?: string
          is_archived?: boolean
          is_master?: boolean
          name: string
          user_id?: string | null
        }
        Update: {
          body_parts?: string[] | null
          created_at?: string
          equipment?: string | null
          id?: string
          is_archived?: boolean
          is_master?: boolean
          name?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exercises_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_logs: {
        Row: {
          calories: number
          carbs: number | null
          created_at: string
          fat: number | null
          fiber: number | null
          food_name: string
          has_components: boolean | null
          healthConnectRecordId: string | null
          id: string
          items: Json | null
          logged_at: string
          logged_date: string | null
          meal_type: string | null
          notes: string | null
          protein: number | null
          serving_size: number | null
          serving_unit: string | null
          user_id: string
        }
        Insert: {
          calories: number
          carbs?: number | null
          created_at?: string
          fat?: number | null
          fiber?: number | null
          food_name: string
          has_components?: boolean | null
          healthConnectRecordId?: string | null
          id?: string
          items?: Json | null
          logged_at?: string
          logged_date?: string | null
          meal_type?: string | null
          notes?: string | null
          protein?: number | null
          serving_size?: number | null
          serving_unit?: string | null
          user_id: string
        }
        Update: {
          calories?: number
          carbs?: number | null
          created_at?: string
          fat?: number | null
          fiber?: number | null
          food_name?: string
          has_components?: boolean | null
          healthConnectRecordId?: string | null
          id?: string
          items?: Json | null
          logged_at?: string
          logged_date?: string | null
          meal_type?: string | null
          notes?: string | null
          protein?: number | null
          serving_size?: number | null
          serving_unit?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      routine_templates: {
        Row: {
          assigned_to: string | null
          created_at: string
          days_of_week: string[] | null
          id: string
          is_master: boolean | null
          name: string
          user_id: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          days_of_week?: string[] | null
          id?: string
          is_master?: boolean | null
          name: string
          user_id: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          days_of_week?: string[] | null
          id?: string
          is_master?: boolean | null
          name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "routine_templates_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      sets: {
        Row: {
          created_at: string
          exercise_id: string
          id: string
          reps: number
          rpe: number | null
          set_index: number | null
          set_type: string | null
          weight: number
          workout_id: string
        }
        Insert: {
          created_at?: string
          exercise_id: string
          id?: string
          reps: number
          rpe?: number | null
          set_index?: number | null
          set_type?: string | null
          weight: number
          workout_id: string
        }
        Update: {
          created_at?: string
          exercise_id?: string
          id?: string
          reps?: number
          rpe?: number | null
          set_index?: number | null
          set_type?: string | null
          weight?: number
          workout_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sets_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sets_workout_id_fkey"
            columns: ["workout_id"]
            isOneToOne: false
            referencedRelation: "workouts"
            referencedColumns: ["id"]
          },
        ]
      }
      template_exercises: {
        Row: {
          created_at: string
          exercise_id: string
          id: string
          order_index: number
          target_reps: number | null
          target_sets: number
          template_id: string
        }
        Insert: {
          created_at?: string
          exercise_id: string
          id?: string
          order_index?: number
          target_reps?: number | null
          target_sets?: number
          template_id: string
        }
        Update: {
          created_at?: string
          exercise_id?: string
          id?: string
          order_index?: number
          target_reps?: number | null
          target_sets?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "template_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "template_exercises_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "routine_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          auto_rest_timer: boolean
          coach_code: string | null
          coach_tier: string | null
          created_at: string
          email: string | null
          id: string
          is_coach_mode: boolean | null
          max_athletes: number | null
          role: string | null
          target_calories: number | null
          target_carbs: number | null
          target_fat: number | null
          target_fiber: number | null
          target_protein: number | null
          terms_accepted_at: string | null
          terms_version: string | null
          timezone: string | null
          trial_ends_at: string | null
          username: string | null
          weight_unit: string
        }
        Insert: {
          auto_rest_timer?: boolean
          coach_code?: string | null
          coach_tier?: string | null
          created_at?: string
          email?: string | null
          id: string
          is_coach_mode?: boolean | null
          max_athletes?: number | null
          role?: string | null
          target_calories?: number | null
          target_carbs?: number | null
          target_fat?: number | null
          target_fiber?: number | null
          target_protein?: number | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          timezone?: string | null
          trial_ends_at?: string | null
          username?: string | null
          weight_unit?: string
        }
        Update: {
          auto_rest_timer?: boolean
          coach_code?: string | null
          coach_tier?: string | null
          created_at?: string
          email?: string | null
          id?: string
          is_coach_mode?: boolean | null
          max_athletes?: number | null
          role?: string | null
          target_calories?: number | null
          target_carbs?: number | null
          target_fat?: number | null
          target_fiber?: number | null
          target_protein?: number | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          timezone?: string | null
          trial_ends_at?: string | null
          username?: string | null
          weight_unit?: string
        }
        Relationships: []
      }
      workouts: {
        Row: {
          created_at: string
          date: string
          id: string
          name: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          date?: string
          id?: string
          name?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workouts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_terms: {
        Args: { p_version: string }
        Returns: Json
      }
      ai_plan_for: {
        Args: {
          p_user_id: string
        }
        Returns: string
      }
      consume_ai_quota: {
        Args: {
          p_cost?: number
        }
        Returns: Json
      }
      disconnect_coach: { Args: { target_athlete_id?: string }; Returns: Json }
      get_exercise_stats: {
        Args: { p_user_id: string }
        Returns: {
          exercise_id: string
          max_weight: number
          pr_reps: number
          recent_sets: Json
          set_count: number
        }[]
      }
      get_ghost_sets: {
        Args: { p_date: string; p_user_id: string }
        Returns: {
          created_at: string
          exercise_id: string
          exercise_name: string
          id: string
          reps: number
          set_index: number
          set_type: string
          weight: number
          workout_date: string
          workout_id: string
          workout_name: string
        }[]
      }
      get_history_sessions: {
        Args: { p_limit?: number; p_offset?: number; p_user_id: string }
        Returns: {
          date: string
          id: string
          name: string
          set_count: number
          total_volume: number
        }[]
      }
      is_athlete_of: { Args: { target_coach_id: string }; Returns: boolean }
      is_coach: { Args: never; Returns: boolean }
      is_coach_of: { Args: { target_athlete_id: string }; Returns: boolean }
      link_to_coach: { Args: { input_code: string }; Returns: Json }
      save_routine_template: {
        Args: {
          p_assigned_to?: string
          p_days_of_week?: string[]
          p_exercises?: Json
          p_is_master?: boolean
          p_name?: string
          p_template_id?: string
          p_user_id?: string
        }
        Returns: Json
      }
      set_coach_code: { Args: { custom_code?: string }; Returns: string }
      update_athlete_macros: {
        Args: {
          p_athlete_id: string
          p_calories: number
          p_carbs: number
          p_fat: number
          p_fiber?: number
          p_protein: number
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

